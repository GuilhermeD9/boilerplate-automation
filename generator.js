const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const clipboardy = require('clipboardy');

const DEFAULT_INPUT_FILE = 'ddl.txt';
const CONFIG_FILE = 'config.json';

let config = {};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            console.log('\x1b[90m📋 Configuração carregada de config.json\x1b[0m');
        } else {
            config = getDefaultConfig();
        }
    } catch (error) {
        console.warn('\x1b[33m⚠️  Erro ao carregar config.json, usando configuração padrão:\x1b[0m', error.message);
        config = getDefaultConfig();
    }
}

function getDefaultConfig() {
    return {
        "naming": {
            "prefixes": ["nr", "cd", "ds", "dt", "fl", "vl", "nm", "tp", "chm", "pes"],
            "tablePrefixes": ["tb"],
            "removeThreeLetterPrefixes": true
        },
        typeMapping: {
            NUMBER: {
                default: 'Integer',
                large: 'Long',
                decimal: 'BigDecimal',
                largeThreshold: 9
            },
            STRING: {
                types: ['CHAR', 'VARCHAR2', 'TEXT'],
                default: 'String'
            },
            DATE: {
                types: ['DATE', 'TIMESTAMP'],
                default: 'LocalDateTime'
            }
        },
        validation: {
            generateAnnotations: true,
            stringValidation: '@NotBlank',
            otherValidation: '@NotNull',
            generateSchema: true
        },
        output: {
            directory: 'generated',
            fileExtensions: {
                entity: '.java',
                dto: 'DTO.java'
            },
            indentation: '    '
        }
    };
}

// Transforma o nome da coluna para camelCase
const toCamelCase = (str) => {
    const namingConfig = config.naming || {};
    const prefixes = namingConfig.prefixes || ['nr', 'cd', 'ds', 'dt', 'fl', 'vl', 'nm', 'tp'];
    
    let parts = str.toLowerCase().split('_');
    if (namingConfig.removeThreeLetterPrefixes && parts[0].length === 3) parts.shift();

    return parts.map((word, index) => {
        if (index === 0) {
            for (const p of prefixes) {
                if (word.startsWith(p) && word.length > p.length) {
                    return p + word.charAt(p.length).toUpperCase() + word.slice(p.length + 1);
                }
            }
            return word;
        } 
        return word.charAt(0).toUpperCase() + word.slice(1);
        }).join('');
};

// Transforma o nome da tabela para PascalCase
const toPascalCase = (str) => {
    const namingConfig = config.naming || {};
    const tablePrefixes = namingConfig.tablePrefixes || ['tb'];
    
    let parts = str.toLowerCase().split('_');
    if (tablePrefixes.includes(parts[0])) parts.shift();
    if (namingConfig.removeThreeLetterPrefixes && parts.length > 0 && parts[0].length === 3) {
        parts.shift();
    }

    return parts.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
};

// Mapeia o tipo do Oracle para o tipo Java
const mapOracleType = (type, precision, scale) => {
    const typeConfig = config.typeMapping || {};
    const validationConfig = config.validation || {};
    
    type = type ? type.toUpperCase() : '';
    precision = parseInt(precision || 0);
    scale = parseInt(scale || 0);

    if (type.includes('NUMBER')) {
        if (scale > 0) return { 
            java: typeConfig.NUMBER?.decimal || 'BigDecimal', 
            annotation: validationConfig.generateAnnotations ? `@Digits(integer = ${precision - scale}, fraction = ${scale})` : '' 
        };
        const threshold = typeConfig.NUMBER?.largeThreshold || 9;
        if (precision > threshold) return { 
            java: typeConfig.NUMBER?.large || 'Long', 
            annotation: validationConfig.generateAnnotations ? `@Min(0) @Max(${'9'.repeat(precision)}L)` : '' 
        };
        return { 
            java: typeConfig.NUMBER?.default || 'Integer', 
            annotation: validationConfig.generateAnnotations ? `@Min(0) @Max(${'9'.repeat(precision)})` : '' 
        };
    }
    
    const stringTypes = typeConfig.STRING?.types || ['CHAR', 'VARCHAR2', 'TEXT'];
    if (stringTypes.some(t => type.includes(t))) { 
        return { 
            java: typeConfig.STRING?.default || 'String', 
            annotation: validationConfig.generateAnnotations ? `@Size(max = ${precision})` : '' 
        };
    }
    
    const dateTypes = typeConfig.DATE?.types || ['DATE'];
    if (dateTypes.some(t => type.includes(t))) { 
        return { 
            java: typeConfig.DATE?.default || 'LocalDateTime', 
            annotation: '' 
        };
    }

    return { java: 'String', annotation: '' };
}

// Analisa o DDL para extrair as informações da tabela
function parseDDL(ddl) {
    const lines = ddl.split('\n');
    let tableName = 'Unknown';
    let schema = 'dbo';
    const columns = [];
    const pks = [];

    const createTableMatch = ddl.match(/CREATE TABLE (\w+)\.(\w+)/i) || ddl.match(/CREATE TABLE (\w+)/i);
    if (createTableMatch) {
        if (createTableMatch.length === 3) {
            schema = createTableMatch[1];
            tableName = createTableMatch[2];
        } else {
            tableName = createTableMatch[1];
        }
    }

    const pkMatch = ddl.match(/PRIMARY KEY \(([^)]+)\)/i);
    if (pkMatch) {
        pkMatch[1].split(',').forEach(pk => pks.push(pk.trim()));
    }

    lines.forEach(line => {
        const trimmed = line.trim();
        const colMatch = trimmed.match(/^(\w+)\s+(\w+)(?:\((\d+)(?:,(\d+))?\))?/);

        if (colMatch && !trimmed.startsWith('CONSTRAINT') && !trimmed.startsWith('CREATE') && !trimmed.startsWith('KEY') && !trimmed.startsWith(')')) {
            const [_, colName, colType, precision, scale] = colMatch;
            const typeInfo = mapOracleType(colType, precision, scale);

            columns.push({
                originalName: colName,
                javaName: toCamelCase(colName),
                pascalName: toCamelCase(colName).charAt(0).toUpperCase() + toCamelCase(colName).slice(1),
                javaType: typeInfo.java,
                annotation: typeInfo.annotation,
                isId: pks.includes(colName)

            });
        }
    });

    return {
        schema,
        originalTableName: tableName,
        className: toPascalCase(tableName),
        columns
    };
}

function generateEntity(data) {
    const outputConfig = config.output || {};
    const indent = outputConfig.indentation || '    ';
    
    const pkClass = data.columns.filter(c => c.isId).length > 1 ? `@IdClass(${data.className}Id.class)` : '';

    return `/** JAVA ENTITY **/

@Data
@Entity
@Table(schema = "${data.schema}", name = "${data.originalTableName}")
${pkClass}
public class ${data.className} implements Serializable {

${indent}@Serial
${indent}private static final long serialVersionUID = 1L;

${data.columns.map(col => {
    let out = '';
    if (col.isId) out += `${indent}@Id\n`;
    out += `${indent}@Column(name = "${col.originalName}")\n${indent}private ${col.javaType} ${col.javaName};`;
    return out;
}).join('\n\n')}
}`; 
}

function generateDTO(data) {
    const validationConfig = config.validation || {};
    const outputConfig = config.output || {};
    const indent = outputConfig.indentation || '    ';
    
    const interfacesList = data.columns.map(c => c.pascalName).join(', ');
    return `/** JAVA DTO **/

public enum ${data.className}DTO {;

${data.columns.map(col => {
    const notBlank = col.javaType === 'String' ? validationConfig.stringValidation || '@NotBlank' : validationConfig.otherValidation || '@NotNull';
    const schemaAnnotation = validationConfig.generateSchema ? '@Schema(description = " ", example = " ")' : '';
    return `${indent}protected interface ${col.pascalName} {
${indent}${notBlank}
${indent}${col.annotation}
${indent}${schemaAnnotation}
${indent}${col.javaType} get${col.pascalName}();
${indent}}`;
}).join('\n\n')}

${indent}public enum Request {;
${indent}${indent}@Data
${indent}${indent}@EqualsAndHashCode(callSuper = true)
${indent}${indent}public static class Base implements ${interfacesList} {
${data.columns.map(col => `${indent}${indent}${indent}private ${col.javaType} ${col.javaName};`).join('\n')}
${indent}${indent}}
        
${indent}${indent}@Data
${indent}${indent}@EqualsAndHashCode(callSuper = true)
${indent}${indent}public static class Cadastro extends Base {}
${indent}}

${indent}public enum Response {;
${indent}${indent}public interface Buscar extends ${interfacesList} {}
${indent}}
}`;
}

function ensureOutputDir() {
    const outputConfig = config.output || {};
    const dir = outputConfig.directory || 'generated';
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function saveFile(filename, content) {
    const outputConfig = config.output || {};
    const dir = outputConfig.directory || 'generated';
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, content, 'utf8');
    return filepath;
}

async function runCLI() {
    loadConfig();
    
    console.log('\x1b[94m🚀 Gerador de Boilerplate Java v2.0\x1b[0m');
    console.log('\x1b[90mTransforme DDL em Entities e DTOs Java\n\x1b[0m');

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'inputFile',
            message: 'Arquivo DDL de entrada:',
            default: DEFAULT_INPUT_FILE,
            validate: (input) => {
                if (!fs.existsSync(input)) {
                    return '\x1b[31mArquivo "' + input + '" não encontrado!\x1b[0m';
                }
                return true;
            }
        },
        {
            type: 'checkbox',
            name: 'outputs',
            message: 'O que deseja gerar? A bolinha indica que a opção está selecionada por padrão.',
            choices: [
                { name: 'Entity JPA', value: 'entity', checked: true },
                { name: 'DTO com validações', value: 'dto', checked: true }
            ]
        },
        {
            type: 'confirm',
            name: 'saveFiles',
            message: 'Salvar arquivos no formato .java em pasta separada?',
            default: true
        },
        {
            type: 'confirm',
            name: 'copyToClipboard',
            message: 'Copiar código para clipboard?',
            default: false
        }
    ]);

    try {
        const ddlContent = fs.readFileSync(answers.inputFile, 'utf8');
        const parsedData = parseDDL(ddlContent);

        console.log('\x1b[32m\n✅ DDL processado com sucesso!\x1b[0m');
        console.log('\x1b[90mTabela: ' + parsedData.originalTableName + ' → ' + parsedData.className + '\x1b[0m');
        console.log('\x1b[90mColunas: ' + parsedData.columns.length + '\x1b[0m');

        const results = [];

        if (answers.outputs.includes('entity')) {
            const entityCode = generateEntity(parsedData);
            results.push({ type: 'Entity', filename: `${parsedData.className}.java`, code: entityCode });
        }

        if (answers.outputs.includes('dto')) {
            const dtoCode = generateDTO(parsedData);
            results.push({ type: 'DTO', filename: `${parsedData.className}DTO.java`, code: dtoCode });
        }

        // Se não selecionou nada, gera ambos por padrão
        if (results.length === 0) {
            const entityCode = generateEntity(parsedData);
            const dtoCode = generateDTO(parsedData);
            results.push(
                { type: 'Entity', filename: `${parsedData.className}.java`, code: entityCode },
                { type: 'DTO', filename: `${parsedData.className}DTO.java`, code: dtoCode }
            );
            console.log('\x1b[90mNenhuma opção selecionada, gerando Entity e DTO por padrão.\x1b[0m');
        }

        if (answers.saveFiles) {
            ensureOutputDir();
            results.forEach(result => {
                const filepath = saveFile(result.filename, result.code);
                console.log('\x1b[32m💾 ' + result.type + ' salvo em: ' + filepath + '\x1b[0m');
            });
        }

        if (answers.copyToClipboard && results.length > 0) {
            const combinedCode = results.map(r => `// ${r.type}\n${r.code}`).join('\n\n' + '='.repeat(50) + '\n\n');
            try {
                clipboardy.default.write(combinedCode);
                console.log('\x1b[33m📋 Código copiado para clipboard!\x1b[0m');
            } catch (error) {
                console.warn('\x1b[33m⚠️  Não foi possível copiar para clipboard:\x1b[0m', error.message);
            }
        }

        if (!answers.saveFiles && !answers.copyToClipboard) {
            console.log('\x1b[94m\n' + '='.repeat(50) + '\x1b[0m');
            results.forEach(result => {
                console.log('\x1b[1m\n--- ' + result.type + ' ---\x1b[0m');
                console.log(result.code);
            });
        }

    } catch (error) {
        console.error('\x1b[31m\n❌ Erro ao processar:\x1b[0m', error.message);
        process.exit(1);
    }
}

// Executa CLI se chamado diretamente
if (require.main === module) {
    runCLI().catch(console.error);
}

module.exports = {
    parseDDL,
    generateEntity,
    generateDTO,
    toCamelCase,
    toPascalCase,
    mapOracleType
};

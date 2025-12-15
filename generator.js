const fs = require('fs');
const path = require('path');

const INPUT_FILE = 'ddl.txt';

const toCamelCase = (str) => {
    const parts = str.toLowerCase().split('_')
    if (parts[0].length === 3) parts.shift();
    return parts.map((word, index) => {
        if (index === 0) return word;
        return word.charAt(0).toUpperCase() + word.slice(1);
        }).join('');
};

const toPascalCase = (str) => {
    const parts = str.toLowerCase().split('_');
    const cleanParts = parts.filter(p => p !== 'tb' && p.length > 3);
    const finalParts = cleanParts.length > 0 ? cleanParts : parts;
    return finalParts.map(word => word.charAt(0).toUpperCase())
};

const mapOracleType = (type, precision, scale) => {
    type = type ? type.toUpperCase() : '';
    precision = parseInt(precision || 0);
    scale = parseInt(scale || 0);

    if (type.includes('NUMBER')) {
        if (scale > 0) return { java: 'BigDecimal', annotation: `@Digits(integer = ${precision - scale}, fraction = ${scale})` };
        if (precision > 9) return { java: 'Long', annotation: `@Min(0) @Max(${'9'.repeat(precision)})` }
        return { java: 'Integer', annotation: `@Min(0) @Max(${'9'.repeat(precision)})` };
    }
    if (type.includes('CHAR') || type.includes ('VARCHAR2') || type.includes('TEXT')) return { java: 'String', annotation: `@Size(max = ${precision})` };
    if (type.includes('DATE')) return { java: 'LocalDateTime', annotation: '' };

    return { java: 'String', annotation: '' };
}

function parseDDL(ddl) {
    const lines = ddl.split('\n');
    let tableName = '';
    let schema = 'dbo';
    const columns = [];
    const pks = [];

    const createTableMatch = ddl.match(/CREATE TABLE (\w+)\.(\w+)/i);
    if (createTableMatch) {
        schema = createTableMatch[1];
        tableName = createTableMatch[2];
    } else {
        const simpleMatch = ddl.match(/CREATE TABLE (\w+)/i);
        if (simpleMatch) tableName = simpleMatch[1];
    }

    const pkMatch = ddl.match(/PRIMARY KEY \(([^)]+)\)/i);
    if (pkMatch) {
        pkMatch[1].split(',').forEach(pk => pks.push(pk.trim()));
    }

    lines.forEach(line => {
        const trimmed = line.trim();
        const colMatch = trimmed.match(/^(\w+)\s+(\w+)(?:\((\d+)(?:,(\d+))?\))?/);

        if (colMatch && !trimmed.startsWith('CONSTRAINT') && !trimmed.startsWith('CREATE') && !trimmed.startsWith('KEY')) {
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
    const pkClass = data.columns.filter(c => c.isId).length > 1 ? `@IdClass(${data.className}Id.class)` : '';
    return `
/** JAVA ENTITY **/

@Data
@Entity
@Table(schema = "${data.schema}", name = "${data.originalTableName}")
${pkClass}
public class ${data.className} implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

${data.columns.map(col => {
    let out = '';
    if (col.isId) out += `   @Id\n`;
    out += `   @Column(name = "${col.originalName}")\n   private ${col.javaType} ${col.javaName};`
    return out;
}).join('\n\n')
}`; 
}

function generateDTO(data) {
    const interfacesList = data.columns.map(c => c.pascalName).join(', ');
    return `
/** JAVA DTO **/

public enum ${data.className}DTO {;

${data.columns.map(col => `   protected interface ${col.pascalName} {
    @NotNull
    ${col.annotation}
    @Schema(description = " ", example = " ")
    ${col.javaType} get${col.pascalName}();
    }`).join('\n')}

    public enum Request {;
        @Data
        @EqualsAndHashCode(callSuper = true)
        public static class Base implements ${interfacesList} {
        ${data.columns.map(col => `           private ${col.javaType} ${col.javaName};`).join('\n')}
        }
        @Data
        @EqualsAndHashCode(callSuper = true)
        public static class Cadastro extends Base { }
    }

    public enum Response {;
        public interface Buscar extends ${interfacesList} {}
    }
}`;
}

try {
    const ddlContent = fs.readFileSync(path.join(__dirname, INPUT_FILE), 'utf8');
    const parsedData = parseDDL(ddlContent);

    console.log(generateEntity(parsedData));
    console.log('\n\n' + '='.repeat(30) + '\n\n');
    console.log(generateDTO(parsedData));

} catch (err) {
    console.error(`Erro: Não foi possível ler o arquivo ${INPUT_FILE}.`);
    console.error(err.message);
}


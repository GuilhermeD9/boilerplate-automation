# Gerador de Boilerplate Java

Ferramenta para transformar DDL de banco de dados Oracle em Entities JPA e DTOs Java com validações.

## 🚀 Funcionalidades

- ✅ **CLI Interativa** - Interface amigável com prompts
- ✅ **Múltiplos Arquivos** - Gera Entity e DTO separados
- ✅ **Configuração Customizável** - Personalize via `config.json`
- ✅ **Validações Automáticas** - Gera anotações Bean Validation
- ✅ **Clipboard Integration** - Copia código gerado
- ✅ **Tratamento de Erros** - Robusto e informativo

## 📦 Instalação

```bash
npm install
```

## 🎯 Uso

### Executar CLI Interativa
```bash
npm start
# ou
node generator.js
```

### Estrutura de Arquivos
```
├── ddl.txt              # Arquivo DDL de entrada
├── config.json          # Configurações customizáveis
├── generator.js         # Script principal
├── generated/           # Pasta de saída (criada automaticamente)
│   ├── Cliente.java     # Entity JPA
│   └── ClienteDTO.java  # DTO com validações
└── package.json
```

## ⚙️ Configuração

Edite `config.json` para personalizar:

```json
{
  "naming": {
    "prefixes": ["nr", "cd", "ds", "dt", "fl", "vl", "nm", "tp"],
    "tablePrefixes": ["tb"],
    "removeThreeLetterPrefixes": true
  },
  "typeMapping": {
    "NUMBER": {
      "default": "Integer",
      "large": "Long", 
      "decimal": "BigDecimal",
      "largeThreshold": 9
    },
    "STRING": {
      "types": ["CHAR", "VARCHAR2", "TEXT"],
      "default": "String"
    },
    "DATE": {
      "types": ["DATE", "TIMESTAMP"],
      "default": "LocalDateTime"
    }
  },
  "validation": {
    "generateAnnotations": true,
    "stringValidation": "@NotBlank",
    "otherValidation": "@NotNull",
    "generateSchema": true
  },
  "output": {
    "directory": "generated",
    "fileExtensions": {
      "entity": ".java",
      "dto": "DTO.java"
    },
    "indentation": "    "
  }
}
```

## 📝 Exemplo DDL

```sql
CREATE TABLE TB_CLIENTE
(
    NR_CLIENTE NUMBER(10) PRIMARY KEY,
    NM_CLIENTE VARCHAR2(100),
    DT_CADASTRO DATE,
    VL_LIMITE_CREDITO NUMBER(15,2),
    DS_EMAIL VARCHAR2(150),
    CD_STATUS NUMBER(3),
    DT_RESSARCIMENTO_CLIENTE DATE,
    FL_ATIVO NUMBER(1)
);
```

## 🎯 Resultado Gerado

### Entity JPA
```java
@Data
@Entity
@Table(schema = "dbo", name = "TB_CLIENTE")
public class Cliente implements Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    @Id
    @Column(name = "NR_CLIENTE")
    private Integer nrCliente;

    @Column(name = "NM_CLIENTE")
    private String nmCliente;

    @Column(name = "DT_CADASTRO")
    private LocalDateTime dtCadastro;

    // ... outras colunas
}
```

### DTO com Validações
```java
public enum ClienteDTO {;

    protected interface NrCliente {
    @NotNull
    @Min(0) @Max(9999999999)
    Integer getNrCliente();
    }

    protected interface NmCliente {
    @NotBlank
    @Size(max = 100)
    String getNmCliente();
    }

    // ... outras interfaces
    
    public enum Request {;
        @Data
        @EqualsAndHashCode(callSuper = true)
        public static class Base implements NrCliente, NmCliente, /* ... */ {
            private Integer nrCliente;
            private String nmCliente;
            // ... outros campos
        }
        
        @Data
        @EqualsAndHashCode(callSuper = true)
        public static class Cadastro extends Base {}
    }

    public enum Response {;
        public interface Buscar extends NrCliente, NmCliente, /* ... */ {}
    }
}
```

## 🔧 Melhorias Implementadas

### Problema de Palavras Compostas ✅
- **Antes**: `dt_ressarcimento_cliente` → `dtRessarcimentocliente`
- **Agora**: `dt_ressarcimento_cliente` → `dtRessarcimentoCliente`

### CLI Interativa ✅
- Escolha o que gerar (Entity/DTO)
- Opção de salvar em arquivos separados
- Integração com clipboard
- Validação de arquivos de entrada

### Configuração Flexível ✅
- Personalize prefixos de nomenclatura
- Configure mapeamento de tipos
- Ajuste validações e anotações
- Defina formato de saída

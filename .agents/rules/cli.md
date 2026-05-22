# CLI & Tool Rules

## Mandatory Tool Replacements
To protect the context window and prevent token limits, you MUST use the following tools instead of their native bash equivalents. Never use the old tools.

| DO NOT USE | USE THIS INSTEAD | WHY |
| :--- | :--- | :--- |
| `ls` or `tree` | `eza --tree --level=2` | Automatically respects gitignore, prevents dumping `.git` or `node_modules` into context. |
| `find` | `fd` | Smart filtering by default. Ex: `fd -e js` |
| `grep` | `rg` (ripgrep) | Token-efficient, respects `.gitignore`. |
| `cat` (for JSON) | `cat file | jq '.key'` | Never dump huge JSON responses. Slice it with `jq`. |
| Regex search | `sg` (ast-grep) | Precise AST structural code searching instead of messy regex. |

## RTK Prefix Rule
You MUST prefix **ALL** bash commands with `rtk`.
- **Bad:** `eza --tree`
- **Good:** `rtk eza --tree`
- **Good:** `rtk rg "function"`
- **Good:** `rtk fd src/`

If you are using built-in agent filesystem tools (like `view_file` or `list_dir`), you do not need RTK. This rule only applies when you execute commands in the terminal.

## Localhost Restart Permission
When working in localhost/dev environment, the agent may restart local services/processes as needed for verification without asking for extra confirmation first.

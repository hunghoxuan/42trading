# AI Boot

Start here.

Read in this order:

1. `README.md`
2. Read [.agents/BOOTSTRAP.md](./.agents/BOOTSTRAP.md) (Agent OS & Pathing).
3. Follow [.agents/rules.md](./.agents/rules.md) (Mandatory Constraints).

Hard rules:

- Follow bootstrap read order.
- Use `rtk` for shell.
- rules for ai agents: read/write ONLY from .agents (not docs)
- tmp files, tmp scripts, used once files: WRITE ONLY in .local (not scripts) 
- do not add new files in `scripts/` or `tests/` unless the user explicitly asks for them and approves it
- NEVER create new files or folders at ROOT level.
- always use or code component-first, clasees-first, mobile-first for UI elements.

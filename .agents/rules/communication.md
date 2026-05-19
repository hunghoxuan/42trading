---
trigger: always_on
---

# Communication Rules

- Caveman style: short, direct, useful.
- No filler.
- State what changed, what was tested, what was deployed with build version, what remains, what need user manual execution. Use checklist format.
- Do not claim tests, deploys, or commits unless done.
- If no manual action exists, do not add a manual-action section.
- Use exact file paths, commands, versions, and endpoints.
- Before doing task, include a section: `AI assumptions/decisions not in spec` with tradeoff + risk.
- After completing task, include:
  - `AI-made changes not in spec`
  - `Tradeoffs considered`
  - `Anything user should be aware of`
- If work is delegated to another agent, always include a copy-paste prompt at end of response with detailed instructions:
  - where to read
  - what to do
  - constraints
  - checks to run
  - expected return format
- If user manual action is required, always include at end of response:
  - a detailed copy-paste prompt for the user
  - exact bash script/commands the user can run

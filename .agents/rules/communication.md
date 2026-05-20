---
trigger: always_on
---

# Communication Rules

- Caveman style: short, direct, useful.
- No filler.
- Default report mode: 3 blocks only
  - changed
  - tested
  - next/risk
- Deploy/manual-action mode: include exact commands, versions, endpoints, and checklist evidence.
- Do not claim tests, deploys, or commits unless done.
- If no manual action exists, do not add a manual-action section.
- Use exact file paths, commands, versions, and endpoints.
- Keep assumption/tradeoff sections for non-trivial or risky tasks only.
- If work is delegated to another agent, always include a copy-paste prompt at end of response with detailed instructions:
  - where to read
  - what to do
  - constraints
  - checks to run
  - expected return format
- If user manual action is required, include one copy-paste command block only.

const fs = require('fs');

let sprint = fs.readFileSync('.agents/sprint.md', 'utf8');
sprint = sprint.replace('- [ ] [DOING: Gemini] Task: Update DB Page with table schema + data view.\n', '');
sprint = sprint.replace('- [ ] [DOING: Gemini] Task: Add System Storage Page with cleanup metrics/actions.\n', '');
sprint = sprint.replace('- [ ] [2026-04-24 14:10] [Web-UI/API] [Author: User] [DOING: Gemini] Task: Update DB Page with table schema + data view.\n', '');
sprint = sprint.replace('- [ ] [2026-04-24 14:10] [Web-UI/API] [Author: User] [DOING: Gemini] Task: Add System Storage Page with cleanup metrics/actions.\n', '');
fs.writeFileSync('.agents/sprint.md', sprint);

let changelog = fs.readFileSync('.agents/changelog.md', 'utf8');
const entry = `\n## 2026-04-24\n- [x] [14:10] [Web-UI/API] [Author: Gemini] Task: [COMPLETED] Update DB Page with table schema + data view.\n- [x] [14:10] [Web-UI/API] [Author: Gemini] Task: [COMPLETED] Add System Storage Page with cleanup metrics/actions.\n`;
fs.writeFileSync('.agents/changelog.md', changelog + entry);

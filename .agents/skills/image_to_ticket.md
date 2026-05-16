# Skill: Image-to-Ticket Analysis

## Overview
This skill defines the process for analyzing technical images (screenshots, console logs, UI mockups) and translating them into structured tickets for other agents or developers who may have restricted vision/image-parsing capabilities.

## Methodology

### 1. Visual Decomposition
Exhaustively describe the visual elements:
- **Details**: Specific text, version numbers, timestamps.
- **Colors**: Hex codes or descriptive names (e.g., "Error Red", "Success Green").
- **Structure**: Layout description, component positions, DevTools tabs active.

### 2. Technical Analysis
Interpret the visual data:
- What is the root cause?
- What are the symptoms?
- How does it relate to the existing codebase?

### 3. Execution Plan
Define the solution:
- **Plan**: High-level strategy.
- **Solution**: Specific code changes or configuration updates.
- **Steps**: Atomic, sequential actions to resolve the issue.

### 4. Goal & Expectation
Define success:
- What is the intended outcome?
- How will it be verified?

## Template

```markdown
# [TICKET-ID] Title

## Image Analysis
- **Text**: [Raw text from image]
- **Context**: [Where in the app, which tool]
- **Visuals**: [Description of colors, icons, state]

## Analysis
[Technical breakdown of the problem]

## Execution Plan
1. [Step 1]
2. [Step 2]

## Goal & Expectation
[Success criteria]
```

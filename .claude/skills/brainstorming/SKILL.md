---
name: brainstorming
description: "Trigger before any creative work, creating features, generating ideas, or planning implementation. Explores user intent, requirements, and design first."
---

# Role: Brainstorming Facilitator

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

## 1. Prime Directives (HARD GATE)

- **Do NOT** invoke any implementation skill, write code, scaffold projects, or take action until you have presented a design and the user has approved it.
- **Do NOT** assume a project is "too simple to need a design". Every project requires this process.

## 2. Knowledge Hub Routing

- For detailed explanations of the methodology (Understanding, Exploring, Presenting) and Key Principles, refer to `references/process_details.md`
- For a visual graph of the workflow, refer to `references/process_flow.md`

## 3. Cognitive Loop (Standard Operating Procedure)

Execute these steps strictly in order:
1. **Explore project context**: Check existing files, docs, and recent commits.
2. **Ask clarifying questions**: One at a time, to understand purpose, constraints, and success criteria. Keep it simple.
3. **Propose 2-3 approaches**: Present logical options with trade-offs, leading with your recommendation.
4. **Present design**: Structure in sections scaled to complexity. Get user approval incrementally after each section.
5. **Write design doc**: Save the validated design to `docs/plans/YYYY-MM-DD-<topic>-design.md` and commit to git.
6. **Transition to implementation**: Invoke the `writing-plans` skill to generate a detailed implementation plan. Do NOT invoke other skills.

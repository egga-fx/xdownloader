---
description: Workflow Creator - Create new workflows for the .agents/workflows/ directory
---

# Workflow Creator

Helps create new workflows with consistent format stored in .agents/workflows/.

## Purpose

Create new workflows with consistent structure. Store workflows in the .agents/workflows/ directory. Follow established format standards. Produce structured and actionable workflows.

## Creation Process

Step 1: Gather Requirements. Ask for workflow name in kebab-case, short description in 1 to 2 sentences, main goal, target user, expected output, and prerequisites.

Step 2: Define Structure. Every workflow needs YAML frontmatter with description field. Main sections: Purpose listing goals, Prerequisites listing requirements, optional Core Principles, numbered Steps or Phases with details, optional Templates and Examples, Usage section with command.

Step 3: Write Content. Follow this structure: frontmatter with description, H1 title, purpose section with bullet list, prerequisites section, core principles with numbered items and details, numbered steps with sub-steps and output statements, optional templates and examples, usage section with command, footer with workflow name version and date.

Step 4: Validate. Check file name uses kebab-case, frontmatter YAML is valid, description is short and clear, structure matches existing workflows, steps are detailed and actionable, code blocks are properly formatted, usage section is clear, footer has version and date, file saved to .agents/workflows/.

Keep each workflow file under 11000 characters. If exceeding this limit, split into related workflows, remove non-essential examples, compress verbose descriptions, or move extensive details to separate documentation.

## Interactive Questionnaire

Ask these questions when creating a workflow from scratch:

1. Workflow name in kebab-case
2. Short description in 1 to 2 sentences
3. Main objectives as a list
4. Target audience
5. Prerequisites needed
6. Step-by-step phases
7. Expected output

## Best Practices

Naming: use kebab-case for file names. Make names descriptive and short.

Description: maximum 1 to 2 sentences. Explain the main purpose clearly.

Structure: follow the existing template format. Use consistent headings.

Steps: break into small actionable steps. Each step must be executable. Include expected output.

Examples: include usage examples. Add templates when needed. Use real-world scenarios.

Versioning: add version number in footer. Update date on every change.

## Validation Checklist

File name is kebab-case. Frontmatter YAML is valid. Description is clear. Purpose section exists. Prerequisites documented. Steps are detailed and actionable. Code blocks formatted correctly. Usage section clear. Footer with version and date. File saved to .agents/workflows/.

---

## ✍️ Document Writing Standards (ROLE AND CORE OBJECTIVE)

All generated reports, plans, audits, and documentation files MUST adhere to the following standards:

> **Role & Core Objective:**
> You are an expert technical writer and AI documentation assistant. Your sole objective is to generate comprehensive, highly visual, and professional documentation optimized for the "Markdown Preview Enhanced" (MPE) extension in VS Code.

### General Formatting Rules
1. **Strict Markdown Format**: Always write output in strict, valid Markdown.
2. **High Scannability**: Use clear heading hierarchies (`##`, `###`), **bold key terms**, use horizontal rules (`---`) to separate major sections, and utilize blockquotes (`>`) for callouts, tips, or warnings.
3. **Mathematical Equations**: If equations or variables are required, use standard LaTeX enclosed in `$inline$` or `$$display$$`.

### MPE-Specific Enhancements (CRITICAL)
Whenever the documentation requires diagrams, data visualizations, complex structures, or advanced formatting, you **MUST** use MPE's extended capabilities instead of plain text descriptions:
1. **Diagrams and Charts (Mermaid.js)**: Flowcharts, sequence diagrams, state diagrams, Gantt charts, or mind maps MUST be rendered using `mermaid` code blocks. Do not draw diagrams using ASCII or text.
2. **Specialized Diagrams (PlantUML / Graphviz)**: For complex software architecture, UML class diagrams, or detailed network topologies, utilize `plantuml` or `dot` (Graphviz) code blocks.
3. **Advanced Tables**: Use clean, well-structured Markdown tables for displaying data.
4. **Code Blocks & Execution**: Always specify the exact language for syntax highlighting in code blocks (e.g., `typescript`, `python`, `json`, `yaml`).

---

## Usage

Create workflow: /workflow-creator

Follow process: gather requirements, define structure, write content, validate, save to .agents/workflows/name.md


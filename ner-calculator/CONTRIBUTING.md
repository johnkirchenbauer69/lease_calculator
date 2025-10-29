# Contribution Workflow (Codex + Humans)

## Branches
- `main` = production branch. Protected. Deployed to production hosting.
- `ai-dev` = development branch. Deployed to staging hosting.

## Rules
1. Do all active work in `ai-dev`.
   - Edit files ONLY inside the `ner-calculator/` directory.
   - Do not create new top-level copies of the app (no `microsite/`, no `v2/`, etc.).
   - Keep the existing structure:  
     `ner-calculator/index.html`, `ner-calculator/css/...`, `ner-calculator/js/...`, `ner-calculator/assets/...`

2. Do **not** push directly to `main`.
   - `main` is only updated by opening a Pull Request from `ai-dev` → `main` and merging after review.
   - This is required so production stays stable and reversible.

3. After pushing to `ai-dev`, staging redeploys automatically.
   - Review changes in the staging environment before promoting them to `main`.

4. When staging looks good:
   - Open a PR (`ai-dev` → `main`).
   - Merging that PR will update production and trigger a production deploy.

5. Rollback:
   - If production looks wrong after a merge, revert the PR in GitHub.  
     This returns `main` to the previous good state and redeploys production.

## Coding Notes
- Put all UI, math, and scenario logic in `ner-calculator/js/*.js`.
- Update the UI in `ner-calculator/index.html`.
- Keep styles in `ner-calculator/css/styles.css`.
- Do not rename the `ner-calculator/` directory without approval.

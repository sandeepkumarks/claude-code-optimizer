#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { initRepo } from "./init.js";
import { analyze } from "./analyzer.js";
import { applySuggestion, rejectSuggestion, listSuggestions, listOpenSuggestions } from "./apply.js";
import { computeAudit, formatAuditReport } from "./audit.js";

function colorStatus(status: string | undefined): string {
  switch (status) {
    case "OPEN":     return chalk.green(`[${status}]`);
    case "APPLIED":  return chalk.gray(`[${status}]`);
    case "REJECTED": return chalk.red(`[${status}]`);
    default:         return `[${status ?? "?"}]`;
  }
}

const program = new Command();

program
  .name("claude-opt")
  .description("Local Claude Code optimizer")
  .version("0.1.0");

program.command("init")
  .description("Install Claude Code local hooks for this repo")
  .action(() => {
    try {
      const result = initRepo(process.cwd());
      console.log(result.alreadyInstalled
        ? chalk.yellow("Hooks already installed. Run claude-opt analyze to generate suggestions.")
        : chalk.green(`Installed local Claude Code hooks: ${result.settingsPath}`)
      );
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.command("analyze")
  .description("Analyze captured Claude Code events and generate suggestions")
  .option("--auto", "Auto-apply safe optimizations (only updates copt-owned CLAUDE.md section)")
  .action(({ auto }) => {
    try {
      const ids = analyze(process.cwd(), !!auto);
      console.log(chalk.green(`Generated/updated ${ids.length} suggestion(s).`));
      if (ids.length > 0 && !auto) {
        console.log(chalk.yellow("Run: claude-opt suggestions"));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.command("suggestions")
  .description("List open suggestions (use --all to include applied and rejected)")
  .option("--all", "Show all suggestions including applied and rejected")
  .action(({ all }) => {
    try {
      const suggestions = all ? listSuggestions(process.cwd()) : listOpenSuggestions(process.cwd());

      if (suggestions.length === 0) {
        console.log(all
          ? chalk.yellow("No suggestions recorded yet. Run Claude Code, then run claude-opt analyze.")
          : chalk.yellow("No open suggestions. Run claude-opt analyze, or use --all to see history.")
        );
        return;
      }

      console.log(chalk.bold(`\n${suggestions.length} suggestion(s)${all ? "" : " (open)"}:`));

      for (const s of suggestions) {
        console.log("\n" + chalk.gray("-".repeat(80)));
        console.log(`${chalk.bold(`#${s.id}`)} ${colorStatus(s.status)} ${chalk.bold(s.title)}`);
        console.log(chalk.dim("Reason:"), s.reason);
        console.log(chalk.dim("\nProposed content:\n"));
        console.log(s.content.split("\n").map(l => `  ${l}`).join("\n"));
        if (s.status === "OPEN") {
          console.log(chalk.yellow(`\n  → Run: claude-opt apply ${s.id}`));
          console.log(chalk.dim(`    or:   claude-opt reject ${s.id}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.command("apply")
  .argument("<id>", "Suggestion id")
  .description("Apply a suggestion")
  .action((id) => {
    try {
      applySuggestion(Number(id), process.cwd());
      console.log(chalk.green(`Applied suggestion ${id}.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.command("reject")
  .argument("<id>", "Suggestion id")
  .description("Reject a suggestion")
  .action((id) => {
    try {
      rejectSuggestion(Number(id), process.cwd());
      console.log(chalk.gray(`Rejected suggestion ${id}.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.command("audit")
  .description("Show impact of applied optimizations on Claude Code behavior")
  .action(() => {
    try {
      const report = computeAudit(process.cwd());
      console.log(formatAuditReport(report));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();

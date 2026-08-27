#!/usr/bin/env node

const [command, ...args] = process.argv.slice(2);

switch (command) {
	case "run":
		console.log("Running Ripple evals...");
		break;

	default:
		console.log(`
Ripple — LLM eval and regression harness

Usage:
  ripple run
`);
}
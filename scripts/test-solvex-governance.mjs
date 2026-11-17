import test from 'node:test';
import assert from 'node:assert/strict';
import { Lifecycle, State } from '../src/lib/lifecycle.ts';

test('SOLVEX Governance: Standard Lifecycle PROPOSED → REVIEWED → AUTHORIZED → RUNNING → VALIDATING → COMPLETED', () => {
  const lc = new Lifecycle();
  lc.setTool('deployer', true, '', true);
  lc.grant('owner-1', 'deployer', 'deploy-prod');

  const humanProposer = { id: 'engineer-1', kind: 'human' };
  const humanReviewer = { id: 'lead-1', kind: 'human' };
  const humanOwner = { id: 'owner-1', kind: 'human' };

  // 1. PROPOSE (Medium Risk)
  const task = lc.propose(humanProposer, 'owner-1', 'Deploy Service', 'deployer', 'deploy-prod', 'MEDIUM');
  assert.equal(task.state, State.PROPOSED);

  // 2. REVIEW (Approve)
  lc.review(task.id, humanReviewer, true);
  assert.equal(task.state, State.REVIEWED);

  // 3. AUTHORIZE
  lc.authorize(task.id, humanOwner);
  assert.equal(task.state, State.AUTHORIZED);

  // 4. RUN → VALIDATING → COMPLETED
  lc.run(task.id, humanOwner);
  assert.equal(task.state, State.COMPLETED);
  assert.equal(task.result, 'demo:deployer.deploy-prod');

  // Verify Audit Chain
  assert.ok(lc.chainOk(), 'Audit chain must be cryptographically sound');
});

test('SOLVEX Governance: Rejection Transition PROPOSED → REJECTED', () => {
  const lc = new Lifecycle();
  lc.setTool('deployer', true, '', true);
  lc.grant('owner-1', 'deployer', 'deploy-prod');

  const humanProposer = { id: 'engineer-1', kind: 'human' };
  const humanReviewer = { id: 'lead-1', kind: 'human' };

  const humanOwner = { id: 'owner-1', kind: 'human' };

  const task = lc.propose(humanProposer, 'owner-1', 'Risky Deploy', 'deployer', 'deploy-prod', 'MEDIUM');
  assert.equal(task.state, State.PROPOSED);

  lc.review(task.id, humanReviewer, false);
  assert.equal(task.state, State.REJECTED);

  // Assert cannot authorize or run a rejected task
  assert.throws(() => lc.authorize(task.id, humanOwner), /invalid transition REJECTED->AUTHORIZED/);
  assert.ok(lc.chainOk());
});

test('SOLVEX Governance: Review Interruption PROPOSED → NEEDS_REVIEW → REVIEWED', () => {
  const lc = new Lifecycle();
  lc.setTool('deployer', true, '', true);
  lc.grant('owner-1', 'deployer', 'deploy-prod');

  const humanProposer = { id: 'engineer-1', kind: 'human' };
  const auditor = { id: 'security-auditor-1', kind: 'human' };

  const task = lc.propose(humanProposer, 'owner-1', 'Complex Patch', 'deployer', 'deploy-prod', 'MEDIUM');
  assert.equal(task.state, State.PROPOSED);

  // Flag NEEDS_REVIEW
  lc.flagNeedsReview(task.id, auditor, 'Requires external security clearance');
  assert.equal(task.state, State.NEEDS_REVIEW);

  // Resolve after review
  lc.resolveNeedsReview(task.id, auditor, true);
  assert.equal(task.state, State.REVIEWED);
  assert.ok(lc.chainOk());
});

test('SOLVEX Governance: Tool Unavailable Fail-Closed AUTHORIZED → BLOCKED → AUTHORIZED', () => {
  const lc = new Lifecycle();
  // Tool is marked unavailable (e.g. missing credentials or offline node)
  lc.setTool('neon-db', false, 'Missing credentials / offline node', true);
  lc.grant('owner-1', 'neon-db', 'migrate');

  const humanProposer = { id: 'engineer-1', kind: 'human' };
  const humanOwner = { id: 'owner-1', kind: 'human' };

  const task = lc.propose(humanProposer, 'owner-1', 'DB Migration', 'neon-db', 'migrate', 'LOW');
  assert.equal(task.state, State.REVIEWED); // Low risk auto-reviewed

  lc.authorize(task.id, humanOwner);
  assert.equal(task.state, State.AUTHORIZED);

  // Run attempt fails closed to BLOCKED
  lc.run(task.id, humanOwner);
  assert.equal(task.state, State.BLOCKED);
  assert.match(task.blockReason, /tool unavailable/);

  // Restore tool and unblock
  lc.setTool('neon-db', true, '', true);
  lc.unblock(task.id, humanOwner);
  assert.equal(task.state, State.AUTHORIZED);

  // Run now succeeds through VALIDATING to COMPLETED
  lc.run(task.id, humanOwner);
  assert.equal(task.state, State.COMPLETED);
  assert.ok(lc.chainOk());
});

test('SOLVEX Governance: Validation Failure & Recovery RUNNING → VALIDATING → FAILED → RECOVERY_REQUIRED', () => {
  const lc = new Lifecycle();
  // Tool validate = false simulates validation failure
  lc.setTool('test-solver', true, '', false);
  lc.grant('owner-1', 'test-solver', 'prove');

  const humanProposer = { id: 'engineer-1', kind: 'human' };
  const humanOwner = { id: 'owner-1', kind: 'human' };

  const task = lc.propose(humanProposer, 'owner-1', 'Solver Invariant', 'test-solver', 'prove', 'LOW');
  lc.authorize(task.id, humanOwner);

  // Run triggers validation failure
  lc.run(task.id, humanOwner);
  assert.equal(task.state, State.FAILED);
  assert.equal(task.error, 'validation failed');

  // Move to RECOVERY_REQUIRED
  lc.flagRecoveryRequired(task.id, humanOwner, 'SMT solver bitrot detected. Must trigger rollbacks.');
  assert.equal(task.state, State.RECOVERY_REQUIRED);

  // Re-authorize recovery operation
  lc.authorizeRecovery(task.id, humanOwner);
  assert.equal(task.state, State.AUTHORIZED);

  assert.ok(lc.chainOk());
});

test('SOLVEX Governance: Prohibit Illegal State Skips (Fail-Closed Enforcement)', () => {
  const lc = new Lifecycle();
  lc.setTool('deployer', true, '', true);
  lc.grant('owner-1', 'deployer', 'deploy-prod');

  const humanProposer = { id: 'engineer-1', kind: 'human' };
  const humanOwner = { id: 'owner-1', kind: 'human' };
  const task = lc.propose(humanProposer, 'owner-1', 'Jump Test', 'deployer', 'deploy-prod', 'MEDIUM');
  assert.equal(task.state, State.PROPOSED);

  // Cannot run directly from PROPOSED
  assert.throws(() => lc.run(task.id, humanOwner), /cannot run from PROPOSED/);

  // Cannot authorize directly from PROPOSED (must be REVIEWED)
  assert.throws(() => lc.authorize(task.id, humanOwner), /invalid transition PROPOSED->AUTHORIZED/);

  assert.ok(lc.chainOk());
});

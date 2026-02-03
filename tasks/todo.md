# Task System Implementation

## Goal
Enable agents to post tasks, claim them, and complete for reputation/bounty.

## API Design

### Endpoints
- [ ] `POST /tasks` — Create task (requires: title, description, optional: bounty, requiredCapabilities)
- [ ] `GET /tasks` — List tasks (filters: status, capability, minBounty)
- [ ] `GET /tasks/:taskId` — Get task details
- [ ] `POST /tasks/:taskId/claim` — Claim task (assigns to claiming agent)
- [ ] `POST /tasks/:taskId/submit` — Submit work (claimant submits result)
- [ ] `POST /tasks/:taskId/approve` — Approve submission (creator approves, triggers payment)
- [ ] `POST /tasks/:taskId/reject` — Reject submission (with reason)
- [ ] `POST /tasks/:taskId/cancel` — Cancel task (creator only, refunds escrow)

### Task Status Flow
```
open → claimed → submitted → approved/rejected
                    ↓
                 disputed (future)
```

### Data Model
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  required_capabilities TEXT, -- JSON array
  bounty_hbar REAL DEFAULT 0,
  escrow_tx TEXT, -- Hedera transaction ID
  status TEXT DEFAULT 'open',
  claimant_id TEXT,
  claimed_at TEXT,
  submission TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_id) REFERENCES agents(id),
  FOREIGN KEY (claimant_id) REFERENCES agents(id)
);
```

## Implementation Steps
- [x] Create tasks table in persistence
- [x] Create tasks.js service
- [x] Create tasks routes
- [x] Add task creation
- [x] Add task claiming
- [x] Add submission flow
- [ ] Add reputation updates on completion
- [ ] (Future) Add HBAR escrow via Hedera SDK

## Notes
- Start without HBAR escrow (reputation-only rewards)
- Add escrow once basic flow works

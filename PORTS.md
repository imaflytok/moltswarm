# MoltSwarm Port Allocation

## Verified Against OnlyFlies Server (2026-02-01)

### Ports In Use (AVOID)
| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | Nginx (HTTP) |
| 443 | Nginx (HTTPS) |
| 3000 | fly-eliza (Docker) |
| 3001 | fly-hub-api (PM2) |
| 3005 | fly-spotifly-api (Docker) |
| 3011 | fly-eliza-relay (Docker) |
| 3055 | PM2 internal |
| 5432 | PostgreSQL (localhost) |
| 6379 | Redis (localhost) |
| 8765 | Codex LAN Server |
| 8766 | OnlyFlies Claude LAN Server |
| 9000-9001 | MinIO (localhost) |
| 18003 | NewRelic (localhost) |

### MoltSwarm Allocation
| Port | Service | Status |
|------|---------|--------|
| **7777** | MoltSwarm API | ✅ Confirmed free |
| **7778** | MoltSwarm WebSocket (future) | ✅ Confirmed free |
| **7779** | MoltSwarm Redis | ✅ Confirmed free |

### Safe Ranges (if we need more)
- 7700-7799: Completely empty
- 9500-9599: Free
- 11000-11999: Large free range
- 12000-12999: Large free range

---

*Audited by OnlyFlies Claude via ssh to 138.199.220.37*

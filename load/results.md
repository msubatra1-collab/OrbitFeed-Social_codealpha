# Local 300-connection load test

- Database: SQLite in WAL mode on a disposable local file
- Duration: 15 seconds
- Connections: 300
- Autocannon overallRate pacing target: 220 requests/sec (approximately 0.73 requests/sec per active connection)
- Workload: feed read, post create, like, and comment create
- General per-IP rate limit: elevated only for this isolated benchmark because all virtual clients share loopback IP
- Requests: 3512
- Average throughput: 234.14 requests/sec (measured, not the pacing target)
- Average latency: 143.44 ms
- p50 latency: 80 ms
- p99 latency: 746 ms
- Errors: 0
- Timeouts: 0
- Non-2xx responses: 0
- Error rate: 0%

This is a local fallback-path result, not production/PostgreSQL capacity proof. SQLite serializes writes; rerun against the configured PostgreSQL and durable storage before treating it as a deployment benchmark.

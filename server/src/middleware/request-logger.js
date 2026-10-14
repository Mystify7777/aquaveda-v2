/**
 * Logs the HTTP method, query-free request path, final response status, and
 * request duration in milliseconds after the response finishes.
 */
export function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
        console.log(JSON.stringify({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        }));
    });

    next();
}

export default requestLogger;
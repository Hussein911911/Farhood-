export function createLogger() {
  const write = (level, event, fields = {}) => {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    };
    const line = JSON.stringify(record);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return Object.freeze({
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  });
}

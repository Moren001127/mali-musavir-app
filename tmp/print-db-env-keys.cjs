console.log(Object.keys(process.env).filter((key) => /DATABASE|POSTGRES|PG/.test(key)).sort().join('\n'));

const AWS = require('aws-sdk');
const PG =  require('pg');
const DDL = require('./ddl-query');

exports.handler = async (event) => {
    try {
        // Retrieve Environment variables for DB Auth
        const host = process.env.DB_ENDPOINT_ADDRESS || '';
        const database = process.env.DB_NAME || '';
        const dbSecretArn = process.env.DB_SECRET_ARN || '';
        const secretsManager = new AWS.SecretsManager({ region: 'us-east-2' });
        const secretParams = {
            SecretId: dbSecretArn,
        };
        const dbSecret = await secretsManager.getSecretValue(secretParams).promise();
        const secretString = dbSecret.SecretString || '';
        if (!secretString) {
            throw new Error('Secret string is empty.');
        }
        const { password } = JSON.parse(secretString);

        // Client connects to DB
        const client = new PG.Client({
            user: 'postgres',
            host,
            database,
            password,
            port: 5432
        });

        await client.connect();
        const ddlQuery = DDL.getDDLQuery(dbVersion, changeDescription);
        console.log(`Executing query: ${ddlQuery}`);

        const ddlResponse = await client.query(ddlQuery);

        await client.end();
    } catch(err) {
        const errorMessage = err instanceof Error ? err.message : err;
        console.log (`Error applying '${changeDescription}': ${errorMessage}`);
        return {
            status: 'ERROR',
            error: err,
            message: errorMessage
          }
    }
}
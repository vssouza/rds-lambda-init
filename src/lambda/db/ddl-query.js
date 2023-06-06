const schemaCreationDDL= `CREATE SCHEMA IF NOT EXISTS sampledb;`;

const tableCreationDDL = `CREATE TABLE IF NOT EXISTS sampledb.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(10) NOT NULL,
    email VARCHAR(50) NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

const insertUserQuery = ` INSERT INTO sampledb.users (
        username, 
        email
    ) VALUES (
        'lambdainit',
        'lambdainit@sampledb.com'
    );`;

exports.getDDLQuery =  (hashId, changeDescription) => {

    return `DO $$
    BEGIN
        BEGIN
            ${schemaCreationDDL}
            ${tableCreationDDL}
            ${insertUserQuery}
        EXCEPTION
            WHEN others THEN
            -- Error handling code here (optional)
            RAISE EXCEPTION 'Error: %', SQLERRM;
            ROLLBACK;
        END;
    END $$;`;
}
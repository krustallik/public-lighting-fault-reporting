# Maintenance-role provisioning recovery

This procedure is for a controlled DBA responding to an interrupted run of [`create-maintenance-roles.psql`](./create-maintenance-roles.psql). It is a manual recovery procedure, not an automated resume path.

## Why interruption needs inspection

`create-maintenance-roles.psql` creates both reserved roles in one transaction and commits before it invokes the hidden `\password` prompts. Interruption after that commit can leave both role names present with zero, one, or both passwords established. [`assert-fresh-maintenance-roles.sql`](./assert-fresh-maintenance-roles.sql) intentionally rejects any existing reserved name; rerunning the creation script is therefore not a recovery mechanism.

## Stop and establish context

1. Stop the provisioning attempt. Do not rerun `create-maintenance-roles.psql`, drop/recreate either role, rename/reuse another identity, or continue if the cluster/database target is uncertain.
2. Connect from the approved DBA channel to the intended cluster and database. Record the non-secret cluster/database identity and maintenance window. Do not include connection strings, passwords, password verifiers, or full command transcripts in evidence.
3. Use an authorized DBA identity with only the privileges needed to inspect role state, set the two reserved passwords, and run the reviewed grant script. Never connect as an application or maintenance identity.

## Classify the interrupted state before changing it

The expected pre-grant partial state is exactly two roles named `lighting_backup` and `lighting_retention`, each with `LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`. Neither role is a member of another role or has another member; neither owns databases or objects; neither has `CREATE`/`TEMP` database privileges, schema `CREATE`, or maintenance table/sequence grants. Since the two `CREATE ROLE` statements are in one transaction, a one-role-only state is unexpected.

Run the following read-only checks first. They return role state and counts only; they do not display a password verifier.

```sql
SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls, rolconnlimit,
       rolvaliduntil, rolconfig
  FROM pg_roles
 WHERE rolname = ANY (ARRAY['lighting_backup', 'lighting_retention'])
 ORDER BY rolname;

SELECT granted.rolname AS granted_role, member.rolname AS member_role
  FROM pg_auth_members membership
  JOIN pg_roles granted ON granted.oid = membership.roleid
  JOIN pg_roles member ON member.oid = membership.member
 WHERE granted.rolname IN ('lighting_backup', 'lighting_retention')
    OR member.rolname IN ('lighting_backup', 'lighting_retention')
 ORDER BY 1, 2;

SELECT datname, pg_get_userbyid(datdba) AS owner
  FROM pg_database
 WHERE pg_get_userbyid(datdba) IN ('lighting_backup', 'lighting_retention');

SELECT role.rolname,
       has_database_privilege(role.rolname, current_database(), 'CREATE') AS database_create,
       has_database_privilege(role.rolname, current_database(), 'TEMP') AS database_temp,
       has_schema_privilege(role.rolname, 'public', 'CREATE') AS public_schema_create
  FROM pg_roles role
 WHERE role.rolname IN ('lighting_backup', 'lighting_retention')
 ORDER BY role.rolname;

SELECT role.rolname, count(*) AS owned_objects
  FROM pg_roles role
  LEFT JOIN pg_shdepend dependency
    ON dependency.refclassid = 'pg_authid'::regclass
   AND dependency.refobjid = role.oid
   AND dependency.deptype = 'o'
 WHERE role.rolname IN ('lighting_backup', 'lighting_retention')
 GROUP BY role.rolname
 ORDER BY role.rolname;
```

The `pg_shdepend` query must be repeated in every connectable application database because database-local object dependencies are local to that database. Inspect effective privileges in each application database as well. Before the reviewed grants have run, any unexplained table/sequence grant is unexpected. If the DBA is authorized to inspect `pg_authid`, record only `rolpassword IS NULL` as a boolean; never select, copy, or log `rolpassword` itself. A mixture of password-set/password-unset is consistent with interruption between the two prompts, but both passwords must still be reset below.

Stop and investigate provenance if a role is missing, has unexpected attributes/configuration, has memberships or ownership, has effective privileges beyond the expected pre-grant state, or the target cannot be established. Do not use the grant script to normalize suspicious state. Do not drop/recreate a reserved identity.

## Complete credentials and apply reviewed grants

Only after the read-only checks establish the expected role state:

1. In the same trusted interactive `psql` session, reset both credentials using psql's hidden prompts:

   ```psql
   \password lighting_backup
   \password lighting_retention
   ```

   Use owner-approved unique credentials delivered through the approved secret channel. Do not put a credential in SQL text, shell arguments, environment dumps, ticket comments, or session transcripts. Reset both roles even if one appears to have a password, because the interrupted prompt's completion is not a reliable record of credential custody.

2. In each canonical application database after its migrations are current, run [`grant-maintenance-roles.sql`](./grant-maintenance-roles.sql) from the trusted DBA session. That script rechecks role attributes, memberships, ownership, and forbidden effective privileges before it reapplies its explicit grants. It clears direct current-table/current-sequence grants before restating the reviewed allowlist; it does not add default privileges.

3. Do not rerun `assert-fresh-maintenance-roles.sql`: its purpose is to prevent adopting pre-existing reserved names. The `DO` assertions inside `grant-maintenance-roles.sql` are the post-creation assertions used for recovery.

## Verify recovery

After the grant script succeeds, verify in each application database:

- exactly the two reserved identities exist and retain the required safe attributes;
- no memberships in either direction and no database/schema/object ownership;
- neither role has database `CREATE`/`TEMP` or schema `CREATE`;
- `lighting_backup` has only the script's read-only table/sequence allowlist;
- `lighting_retention` has only its listed column reads and `DELETE` on `admin_activity_logs`, `inventory_audit_events`, and `admin_refresh_sessions`; it has no import-history deletion grant;
- credentials were set without exposing verifiers, and a controlled authentication check through the approved secret path succeeds.

If any postcondition fails, stop. Do not broaden grants or retry role creation. Preserve secret-free evidence of the inspection, script result, effective privileges, and accountable DBA approval.

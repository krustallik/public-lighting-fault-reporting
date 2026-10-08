-- Reserved operational identities; intentionally not members of application
-- roles and not granted database/object privileges in this file.
CREATE ROLE lighting_backup LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE lighting_retention LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

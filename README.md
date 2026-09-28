# LeaseIQ Societies

A society-management platform for chairmen, residents, owners, and tenants.

This repository contains the Next.js web application and backend APIs. A separate native Android application consumes the backend APIs.

## Technology

- Next.js App Router and React
- TypeScript
- PostgreSQL with parameterized SQL through `pg`
- Zod validation
- Argon2 password hashing
- Tailwind CSS and CSS Modules
- S3-compatible private object storage
- ClamAV attachment scanning
- Railway deployment

## Features

### Authentication
- Mobile number and password sign-in
- Email OTP sign-in for chairman and resident portals
- Email-based password recovery
- Email verification and resend controls
- Web sessions and Android access/refresh sessions
- Password-reset session revocation

### Resident account
- City-first society and flat selection
- Application drafts, submission, and status tracking
- Changes-requested and resubmission flows
- Multiple homes linked to one account
- Personal details and preferred name
- Account-level correspondence address

### Chairman workspace
- Resident application review
- Unit registry and spreadsheet import/export
- Invoice workflows
- Ownership-transfer review

### Documents and ownership transfers
- PDF, JPG, and PNG attachments
- File-type validation and malware scanning
- Private bucket storage with application-controlled access
- Ownership-transfer confirmations and audit history

Ownership-transfer workflows update society records and application access.
They do not constitute a legal transfer of property title.

## Development Status

The application is under active development.

Reported validation includes passing authentication regression tests,
TypeScript checks, focused lint checks, and a production application build.

The following still require verification or completion:

- Docker image build and Railway scanner operation
- Real bucket uploads, downloads, and permission checks
- Live email OTP and password-recovery flows
- Complete tenant submission and approval workflows
- Android parity with recent web features
- Security-staff portal
- Production deployment and end-to-end smoke testing

Passing local checks does not establish production readiness.

## Local Development

### Prerequisites

- Node.js 24
- npm
- PostgreSQL
- ClamAV with current virus definitions, if testing uploads locally
- Private S3-compatible bucket credentials, if testing uploads locally

Install dependencies:

    npm ci

Create an untracked `.env.local` with the required configuration.

Apply local development migrations:

    npm run db:migrate:dev

The development migration runner is restricted to a local database named
`leaseiq_societies_dev`.

Start the development server:

    npm run dev

## Configuration

Never commit credentials or `.env.local`.

### Database

- `PGHOST`
- `PGPORT`
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`

### Application and authentication

- `APP_ORIGIN`
- `OTP_HASH_SECRET`
- `REGISTRATION_VERIFICATION`
- `VERIFICATION_DELIVERY`

`APP_ORIGIN` must match the application's origin, including its scheme and
port where applicable.

`OTP_HASH_SECRET` must contain exactly 64 hexadecimal characters.

The current production email-delivery configuration uses:

- `REGISTRATION_VERIFICATION=email_only`
- `VERIFICATION_DELIVERY=gmail`

### Gmail delivery

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_SENDER_EMAIL`

### Private document storage

- `BUCKET`
- `ENDPOINT`
- `REGION`
- `ACCESS_KEY_ID`
- `SECRET_ACCESS_KEY`
- `DOCUMENT_STORAGE_URL_STYLE`
- `DOCUMENT_CLAMSCAN_PATH` — optional locally; configured by the Docker image

Use the bucket provider's required URL style: `virtual` or `path`.

Storage credentials are server-side only. Local bucket configuration is
needed only when testing uploads from the local application.

## Document Handling

The current upload flow:

1. Authenticates the user and checks application access.
2. Validates the file size, extension, and content signature.
3. Scans the file with ClamAV.
4. Stores the file in a private bucket.
5. Records document metadata and audit events in PostgreSQL.

Uploads support PDF, JPG, and PNG files up to 10 MB, with a maximum of five
active attachments per application under the current policy.

Downloads pass through the backend after authorization. Removing an attachment
currently marks its database record as deleted; physical bucket-object cleanup
requires a separate retention and cleanup process.

Scanning reduces malware risk but cannot guarantee that every file is safe.

## Validation

TypeScript:

    npx --no-install tsc --noEmit --incremental false

Lint:

    npm run lint

Production build:

    npm run build

Selected authentication tests:

    node --conditions=react-server --import tsx --test \
      tests/email-auth-contracts.test.ts \
      tests/email-auth-delivery.test.ts \
      tests/email-auth-database.test.ts \
      tests/password-session-database.test.ts

Database tests create and clean up test fixtures. Run them only against the
explicitly guarded local development database, never production.

## Railway Deployment

The repository includes:

- `Dockerfile`
- `.dockerignore`
- `scripts/start-railway.sh`
- `scripts/scan-document.sh`
- `scripts/freshclam.conf`

The Docker configuration installs ClamAV and starts FreshClam to update virus
definitions. Uploads remain unavailable until scanning can succeed.

The scanner wrapper limits concurrent scans per container and rejects
definitions older than three days.

### Service settings

- Leave the custom Start Command empty to use the image's startup command.
- Set the Pre-deploy Command to:

      npm run db:migrate:production

The production migration runner requires Railway environment configuration
and a PostgreSQL private-network hostname ending in `.railway.internal`.

Configure database, email, origin, and bucket variables on the backend service.
Do not include local environment files in the image.

### Deployment checks

Before deploying:

- Review pending migrations and back up the target database.
- Build and validate the application.
- Verify the Docker image and scanner.
- Test authentication, email delivery, uploads, and permissions in staging.
- Prepare application rollback and database recovery procedures.

Reverting application code does not automatically reverse database migrations.

## Development Guidance

Read the relevant installed Next.js documentation in:

    node_modules/next/dist/docs/

Follow repository instructions before changing framework code.

Preserve historical applications and audit records. Validate permissions and
state transitions on the server, and use transactions for related database
changes.

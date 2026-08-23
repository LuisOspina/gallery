# Luis Ospina Gallery

A small Astro and TypeScript photo gallery hosted on AWS.

## Local development

1. Install [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/).
2. Copy `.env.example` to `.env` and fill in the public AWS application values.
3. Run `pnpm install`.
4. Run `pnpm dev`.

The gallery will be available at `http://localhost:4321`.

## Structure

- `src/pages/index.astro` displays the gallery.
- `src/pages/media/index.astro` displays one photo at `/media/<uuid>`.
- `src/pages/admin/index.astro` provides the private upload form.
- `backend/api/index.mjs` contains the small Lambda API.
- `backend/aws/rewrite.js` preserves the clean media and admin URLs in CloudFront.

## AWS services

- S3 stores the static site, private originals, and public display sizes.
- CloudFront delivers the site and processed photos over HTTPS.
- DynamoDB stores photo metadata.
- API Gateway and Lambda provide public reads and protected uploads.
- Cognito provides the administrator sign-in with required authenticator-app MFA.
- Route 53 and ACM connect `gallery.luisospina.ca` and its certificate.
- GitHub Actions deploys `main` using short-lived AWS credentials through OIDC.

The public browser configuration contains an API URL and Cognito client ID. These identify the application but are not passwords or AWS credentials. Originals and AWS write operations remain private.

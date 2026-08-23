/// <reference types="astro/client" />

interface ImportMetaEnv {
	readonly PUBLIC_API_URL?: string;
	readonly PUBLIC_COGNITO_CLIENT_ID?: string;
	readonly PUBLIC_COGNITO_DOMAIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

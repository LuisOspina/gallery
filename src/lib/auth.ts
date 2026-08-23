const clientId = import.meta.env.PUBLIC_COGNITO_CLIENT_ID;
const domain = import.meta.env.PUBLIC_COGNITO_DOMAIN?.replace(/\/$/, "");

const encode = (bytes: ArrayBuffer | Uint8Array) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export const authIsConfigured = Boolean(clientId && domain);

export async function signIn() {
	const values = crypto.getRandomValues(new Uint8Array(64));
	const verifier = encode(values);
	const challenge = encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
	const state = encode(crypto.getRandomValues(new Uint8Array(24)));
	const redirectUri = `${location.origin}/admin`;

	sessionStorage.setItem("pkce_verifier", verifier);
	sessionStorage.setItem("oauth_state", state);

	const query = new URLSearchParams({
		client_id: clientId,
		response_type: "code",
		scope: "openid email",
		redirect_uri: redirectUri,
		code_challenge_method: "S256",
		code_challenge: challenge,
		state,
	});

	location.href = `${domain}/oauth2/authorize?${query}`;
}

export async function finishSignIn() {
	const query = new URLSearchParams(location.search);
	const code = query.get("code");
	if (!code) return;

	const state = query.get("state");
	const savedState = sessionStorage.getItem("oauth_state");
	const verifier = sessionStorage.getItem("pkce_verifier");

	if (!state || state !== savedState || !verifier) {
		throw new Error("The sign-in response could not be verified.");
	}

	const redirectUri = `${location.origin}/admin`;
	const response = await fetch(`${domain}/oauth2/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
		}),
	});

	if (!response.ok) throw new Error("Sign-in could not be completed.");

	const tokens = await response.json();
	sessionStorage.setItem("access_token", tokens.access_token);
	sessionStorage.setItem("id_token", tokens.id_token);
	sessionStorage.setItem("expires_at", String(Date.now() + tokens.expires_in * 1000));
	sessionStorage.removeItem("pkce_verifier");
	sessionStorage.removeItem("oauth_state");
	history.replaceState({}, "", "/admin");
}

export function getAccessToken() {
	const expiresAt = Number(sessionStorage.getItem("expires_at"));
	if (!expiresAt || Date.now() >= expiresAt) return;
	return sessionStorage.getItem("access_token") || undefined;
}

export function getSignedInEmail() {
	const token = sessionStorage.getItem("id_token");
	if (!token) return;

	try {
		const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
		return JSON.parse(atob(payload)).email as string;
	} catch {
		return;
	}
}

export function signOut() {
	sessionStorage.clear();
	const query = new URLSearchParams({ client_id: clientId, logout_uri: `${location.origin}/admin` });
	location.href = `${domain}/logout?${query}`;
}

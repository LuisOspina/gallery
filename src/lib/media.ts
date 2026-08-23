export interface MediaItem {
	id: string;
	title: string;
	subtitle: string;
	city: string;
	country: string;
	capturedAt?: string;
	uploadedAt: string;
	thumbnailUrl: string;
	displayUrl: string;
	width: number;
	height: number;
}

const apiUrl = import.meta.env.PUBLIC_API_URL?.replace(/\/$/, "");

async function request<T>(path: string): Promise<T> {
	const response = await fetch(apiUrl ? `${apiUrl}${path}` : "/data/media.json");

	if (!response.ok) {
		throw new Error("The gallery could not be loaded.");
	}

	return response.json() as Promise<T>;
}

export async function listMedia(): Promise<MediaItem[]> {
	return request<MediaItem[]>("/media");
}

export async function getMedia(id: string): Promise<MediaItem | undefined> {
	if (apiUrl) {
		return request<MediaItem>(`/media/${encodeURIComponent(id)}`);
	}

	const items = await listMedia();
	return items.find((item) => item.id === id);
}

import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DeleteCommand,
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const database = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const storage = new S3Client({});
const allowedTypes = new Map([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
]);

const response = (statusCode, body) => ({
	statusCode,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

const clean = (value, length) => String(value || "").trim().slice(0, length);
const cleanTags = (tags) => [...new Set(
	(Array.isArray(tags) ? tags : [])
		.map((tag) => clean(tag, 30))
		.filter(Boolean),
)].slice(0, 12);

const publicItem = (item) => ({
	id: item.id,
	caption: item.caption ?? "",
	city: item.city ?? "",
	tags: item.tags || [],
	createdAt: item.createdAt || item.uploadedAt,
	thumbnailUrl: `${process.env.MEDIA_BASE_URL}/${item.thumbnailKey}`,
	displayUrl: `${process.env.MEDIA_BASE_URL}/${item.displayKey}`,
	width: item.width,
	height: item.height,
});

export async function handler(event) {
	try {
		if (event.routeKey === "GET /media") {
			const result = await database.send(new ScanCommand({ TableName: process.env.TABLE_NAME }));
			const items = (result.Items || [])
				.filter((item) => item.status === "ready" && !item.hidden)
				.sort((a, b) => (b.createdAt || b.uploadedAt).localeCompare(a.createdAt || a.uploadedAt))
				.map(publicItem);
			return response(200, items);
		}

		if (event.routeKey === "GET /admin/media") {
			const result = await database.send(new ScanCommand({ TableName: process.env.TABLE_NAME }));
			const items = (result.Items || [])
				.filter((item) => item.status === "ready")
				.sort((a, b) => (b.createdAt || b.uploadedAt).localeCompare(a.createdAt || a.uploadedAt))
				.map((item) => ({ ...publicItem(item), hidden: Boolean(item.hidden) }));
			return response(200, items);
		}

		if (event.routeKey === "GET /media/{id}") {
			const result = await database.send(new GetCommand({
				TableName: process.env.TABLE_NAME,
				Key: { id: event.pathParameters.id },
			}));

			if (!result.Item || result.Item.status !== "ready" || result.Item.hidden) {
				return response(404, { message: "Photo not found" });
			}

			return response(200, publicItem(result.Item));
		}

		if (event.routeKey === "POST /uploads") {
			const body = JSON.parse(event.body || "{}");
			const extension = allowedTypes.get(body.contentType);

			if (!extension) {
				return response(400, { message: "Please choose a JPEG, PNG, or WebP image." });
			}

			const id = randomUUID();
			const originalKey = `originals/${id}.${extension}`;
			const displayKey = `images/display/${id}.webp`;
			const thumbnailKey = `images/thumbnails/${id}.webp`;
			const createdAt = new Date().toISOString();
			const item = {
				id,
				caption: clean(body.caption, 240),
				city: clean(body.city, 80),
				tags: cleanTags(body.tags),
				createdAt,
				hidden: false,
				originalKey,
				displayKey,
				thumbnailKey,
				status: "uploading",
			};

			await database.send(new PutCommand({ TableName: process.env.TABLE_NAME, Item: item }));

			const sign = (Bucket, Key, ContentType) => getSignedUrl(
				storage,
				new PutObjectCommand({ Bucket, Key, ContentType }),
				{ expiresIn: 900 },
			);
			const [originalUrl, displayUrl, thumbnailUrl] = await Promise.all([
				sign(process.env.ORIGINAL_BUCKET, originalKey, body.contentType),
				sign(process.env.MEDIA_BUCKET, displayKey, "image/webp"),
				sign(process.env.MEDIA_BUCKET, thumbnailKey, "image/webp"),
			]);

			return response(201, { id, originalUrl, displayUrl, thumbnailUrl });
		}

		if (event.routeKey === "POST /uploads/{id}/complete") {
			const body = JSON.parse(event.body || "{}");
			await database.send(new UpdateCommand({
				TableName: process.env.TABLE_NAME,
				Key: { id: event.pathParameters.id },
				UpdateExpression: "SET #status = :ready, width = :width, height = :height",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":ready": "ready",
					":width": Number(body.width),
					":height": Number(body.height),
				},
				ConditionExpression: "attribute_exists(id)",
			}));

			return response(200, { id: event.pathParameters.id });
		}

		if (event.routeKey === "PUT /media/{id}") {
			const body = JSON.parse(event.body || "{}");
			const result = await database.send(new UpdateCommand({
				TableName: process.env.TABLE_NAME,
				Key: { id: event.pathParameters.id },
				UpdateExpression: "SET caption = :caption, city = :city, tags = :tags, #hidden = :hidden",
				ExpressionAttributeNames: { "#hidden": "hidden" },
				ExpressionAttributeValues: {
					":caption": clean(body.caption, 240),
					":city": clean(body.city, 80),
					":tags": cleanTags(body.tags),
					":hidden": Boolean(body.hidden),
				},
				ConditionExpression: "attribute_exists(id)",
				ReturnValues: "ALL_NEW",
			}));

			return response(200, { ...publicItem(result.Attributes), hidden: Boolean(result.Attributes.hidden) });
		}

		if (event.routeKey === "DELETE /media/{id}") {
			const id = event.pathParameters.id;
			const result = await database.send(new GetCommand({
				TableName: process.env.TABLE_NAME,
				Key: { id },
			}));

			if (!result.Item) return response(404, { message: "Photo not found" });

			await Promise.all([
				storage.send(new DeleteObjectCommand({
					Bucket: process.env.ORIGINAL_BUCKET,
					Key: result.Item.originalKey,
				})),
				storage.send(new DeleteObjectCommand({
					Bucket: process.env.MEDIA_BUCKET,
					Key: result.Item.displayKey,
				})),
				storage.send(new DeleteObjectCommand({
					Bucket: process.env.MEDIA_BUCKET,
					Key: result.Item.thumbnailKey,
				})),
			]);
			await database.send(new DeleteCommand({
				TableName: process.env.TABLE_NAME,
				Key: { id },
			}));

			return response(200, { id });
		}

		return response(404, { message: "Route not found" });
	} catch (error) {
		console.error(error);
		return response(error.name === "ConditionalCheckFailedException" ? 404 : 500, {
			message: error.name === "ConditionalCheckFailedException" ? "Photo not found" : "Something went wrong",
		});
	}
}

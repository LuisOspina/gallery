import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	ScanCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

const publicItem = (item) => ({
	id: item.id,
	title: item.title,
	subtitle: item.subtitle,
	city: item.city,
	country: item.country,
	...(item.capturedAt ? { capturedAt: item.capturedAt } : {}),
	uploadedAt: item.uploadedAt,
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
				.filter((item) => item.status === "ready")
				.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
				.map(publicItem);
			return response(200, items);
		}

		if (event.routeKey === "GET /media/{id}") {
			const result = await database.send(new GetCommand({
				TableName: process.env.TABLE_NAME,
				Key: { id: event.pathParameters.id },
			}));

			if (!result.Item || result.Item.status !== "ready") {
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
			const uploadedAt = new Date().toISOString();
			const item = {
				id,
				title: clean(body.title, 100),
				subtitle: clean(body.subtitle, 200),
				city: clean(body.city, 80),
				country: clean(body.country, 80),
				capturedAt: clean(body.capturedAt, 40),
				uploadedAt,
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
				UpdateExpression: "SET title = :title, subtitle = :subtitle, city = :city, country = :country, capturedAt = :capturedAt",
				ExpressionAttributeValues: {
					":title": clean(body.title, 100),
					":subtitle": clean(body.subtitle, 200),
					":city": clean(body.city, 80),
					":country": clean(body.country, 80),
					":capturedAt": clean(body.capturedAt, 40),
				},
				ConditionExpression: "attribute_exists(id)",
				ReturnValues: "ALL_NEW",
			}));

			return response(200, result.Attributes.status === "ready" ? publicItem(result.Attributes) : result.Attributes);
		}

		return response(404, { message: "Route not found" });
	} catch (error) {
		console.error(error);
		return response(error.name === "ConditionalCheckFailedException" ? 404 : 500, {
			message: error.name === "ConditionalCheckFailedException" ? "Photo not found" : "Something went wrong",
		});
	}
}

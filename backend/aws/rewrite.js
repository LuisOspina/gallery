function handler(event) {
	var request = event.request;
	var path = request.uri;

	if (path === "/admin" || path === "/admin/") {
		request.uri = "/admin/index.html";
	} else if (path.indexOf("/media/") === 0) {
		request.uri = "/media/index.html";
	}

	return request;
}

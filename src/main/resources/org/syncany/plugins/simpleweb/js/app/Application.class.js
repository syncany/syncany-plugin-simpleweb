$(document).ready(function() {
	new Application();
});

function Application() {
	var isTls = window.location.protocol == "https:";
	var rsSchema = isTls ? "https://" : "http://";
	var wsSchema = isTls ? "wss://" : "ws://";
	
	var rsUri = rsSchema + window.location.host + "/api/rs";
	var wsUri = wsSchema + window.location.host + "/api/ws";

	var prefix = "";
	var root = "";
	var dateSelected = "";
	
	var rootSelect = $("#root");
	var dateSelect = new DateSelect($('#dateslider'), $('#datetext'), onDatabaseVersionHeaderChange);
	var tree = new Tree($('#tree'), onFolderClick);
	var status = new Status($('#status'));
	var table = new Table($('#table'), onContextFileInfoClick, onContextPreviousVersionsClick, onFileClick, onFolderClick);
	
	var wsReady = false;

	$('#menu').selectric();
		
	rootSelect.selectric();
	rootSelect.change(onRootSelect);

	setGuiConnected(false);
	doConnect();

	function doConnect() {
		websocket = new WebSocket(wsUri);
		
		websocket.onopen = function (evt) { onOpen(evt) };
		websocket.onclose = function (evt) { onClose(evt) };
		websocket.onmessage = function (evt) { onMessage(evt) };
		websocket.onerror = function (evt) { onError(evt) };
	
		status.loading("Connecting to Syncany ...");
	}

	function doDisconnect() {
		websocket.close()
		status.okay("Disconnected");
	}

	function sendMessage(msg) {
		console.log(msg);
		waitForConnection(function() {
			websocket.send(msg);
			}, 1000);
	}
	
	function waitForConnection(callback, interval) {
	    if (wsReady) {
	        callback();
	    } else {
	    	console.log("Waiting for ws connection readyState === 1." + websocket.readyState)
	        setTimeout(function () {
	            waitForConnection(callback, interval);
	        },interval);
	    }
	}

	function onOpen(evt) {
		setGuiConnected(true);
		wsReady = true;
		status.okay("Connected");

		sendListWatchesRequest();
	}

	function onClose(evt) {
		setGuiConnected(false);
	}

	function onMessage(evt) {
		console.log(evt);
	
		var xml = $(evt.data.toString());

		if (xml && xml[0]) {		
			var responseType = xml[0].nodeName.toString().toLowerCase();
			var codeXml = xml.find('code');

			if (codeXml && codeXml.text() == 200) {	
				if (responseType == "getfiletreeresponse") {
					processFileTreeResponse(xml);
				}
				else if (responseType == "getfileresponse") {
					processFileResponse(xml);
				}
				else if (responseType == "getfilehistoryresponse") {
					processFileHistoryResponse(xml);
				}
				else if (responseType == "listwatchesresponse") {
					processListWatchesResponse(xml);
				}
				else if (responseType == "watcheventresponse") {
					processWatchEventResponse(xml);
				}
				else if (responseType == "getdatabaseversionheadersresponse") {
					processGetDatabaseVersionHeadersResponse(xml);
				}
				else if (responseType == "restoreresponse") {
					processRestoreResponse(xml);
				}
				else {
					console.log('WARNING: Unknown response: ' + evt.data.toString());
				}
			}
			else {
				console.log(xml);
				console.log(codeXml);
				console.log('ERROR: Illegal response code: ' + codeXml);
			}
		}
		else {
			console.log('ERROR: Illegal response: ' + evt.data.toString());
		}
	}

	function processFileTreeResponse(xml) {
		status.loading('Updating tables');

		prefix = xml.find('prefix').text(); // new prefix!

		var fileVersions = toFileVersions(xml);
	
		table.populateTable(prefix, fileVersions);
		tree.populateTree(prefix, fileVersions);

		status.okay('All files in sync');
	}

	function processFileResponse(xml) {
		var tempFileToken = xml.find('tempFileToken').text();
		window.open(rsUri + "/file/" + tempFileToken);
	}

	function processFileHistoryResponse(xml) {
		status.okay('All files in sync');

		var dialogElements = $("#dialog-previous-versions");
		var tableElements = $("#dialog-previous-versions table");
		var fileVersions = toFileVersions(xml);
		var selectedFile = null;
	
		tableElements.dataTable().fnDestroy();
	
		var dialogTable = tableElements.DataTable({
			paging: false,
			searching: false,
			jQueryUI: false,
			info: false,
			ordering: true,
			data: fileVersions,
			order: [ [1, 'desc' ] ],
			columns: [
				{ data: 'path' },
				{ data: 'version' },
				{ data: 'type' },
				{ data: 'status' },
				{ data: 'size', className: "right" },
				{ data: 'checksum' },
				{ data: 'updated' },
				{ data: 'lastModified' },
				{ data: 'posixPermissions' },
				{ data: 'dosAttributes' }
			]
		});
	
		tableElements.$('tbody tr').click(function () {
			// Highlight
			if ($(this).hasClass('selected')) {
				$(this).removeClass('selected');			
				dialogElements.parent().find(":button:contains('Restore')").prop("disabled", true).addClass('ui-state-disabled');
			
				selectedFile = null;
			}
			else {
				tableElements.$('tr.selected').removeClass('selected');
			
				$(this).addClass('selected');
				dialogElements.parent().find(":button:contains('Restore')").prop("disabled", false).removeClass('ui-state-disabled');

				selectedFile = dialogTable.row($(this)).data();
			}
		});
		
		dialogElements.dialog({
			title: "Previous File Versions",
			position: 'center',
			width: $(window).width()-100,
			height: $(window).height()-100,
			modal: true,
			buttons: [ 
				{ 
					text: "Restore selected", 
					click: function() { 
						sendRestoreRequest(selectedFile);				
						$(this).dialog("close");  
					}
				}, 
				{ 
					text: "Close", 
					click: function() { 
						$(this).dialog("close");  
					}
				}
			]	
		});
	
		dialogElements.parent().find(":button:contains('Restore')").prop("disabled", true).addClass('ui-state-disabled');

	}

	function processRestoreResponse(xml) {
		onRootSelect();
	}

	function processWatchEventResponse(xml) {
		var action = xml.find('action').text();
		var subject = xml.find('subject').text();
	
		var statusText = "";
	
		if (action == "UPLOAD_START") {
			status.loading("Uploading files");
		}
		else if (action == "UPLOAD_FILE") {
			status.loading("Uploading " + subject);
		}
		else if (action == "UPLOAD_END") {
			status.okay("Upload successful");
		}
		else if (action == "INDEX_START") {
			status.loading("Indexing files");
		}
		else if (action == "INDEX_FILE") {
			status.loading("Indexing " + subject);
		}
		else if (action == "INDEX_END") {
			status.okay("Indexing successful");
		}
		else if (action == "DOWNLOAD_START") {
			status.loading("Downloading files");
		}
		else if (action == "DOWNLOAD_FILE") {
			status.loading("Downloading " + subject);
		}
		else {
			status.loading("Unknown action: " + action);
		}
	}

	function processListWatchesResponse(xml) {
		rootSelect.find('option').remove();

		var watches = xml.find('watches > watch');
	
		$(watches).each(function (i, watch) {
			console.log($(watch).text());
		
			var rootPath = $(watch).text();
			rootSelect.append($("<option />").val(rootPath).text(basename(rootPath)));
		});
	
		$('#root').selectric('refresh');
		onRootSelect();
	}

	function processGetDatabaseVersionHeadersResponse(xml) {
		var datesXml = xml.find('date');
		var dates = $.map(datesXml, function(d) { return $(d).text(); });
	
		console.log(dates);
		dateSelect.updateSlider(dates);
	}

	function onRootSelect() {
		root = rootSelect.find("option:selected").first().val();
		console.log("new root: "+root);
	
		tree.clear(root);
	
		sendFileTreeRequest("");
		sendGetDatabaseVersionHeaders();
	}

	function onFileClick(file) {
		sendGetFileRequest(file);
	}

	function onFolderClick(file) {
		status.loading('Retrieving file list');
	
		if (file) {
			sendFileTreeRequest(file.path+"/");
		}
		else {
			sendFileTreeRequest("");
		}
	}

	function onContextFileInfoClick(file) {
		$("#dialog-fileinfo .name").html(basename(file.path));
		$("#dialog-fileinfo .type").html(file.type);
		$("#dialog-fileinfo .size").html(formatFileSize(file.size));
		$("#dialog-fileinfo .location").html(file.path);
		$("#dialog-fileinfo .lastModified").html(file.lastModified);
		$("#dialog-fileinfo .updated").html(file.updated);
		$("#dialog-fileinfo .checksum").html(file.checksum);
		$("#dialog-fileinfo .posixPermissions").html(file.posixPermissions);
		$("#dialog-fileinfo .dosAttributes").html(file.dosAttributes);
		$("#dialog-fileinfo .fileHistoryId").html(file.fileHistoryId);
		$("#dialog-fileinfo .version").html(file.version);
	
		$("#dialog-fileinfo").dialog({
			title: "File Properties",
			minWidth: 500,
			minHeight: 300,
			modal: true,
			buttons: [ { text: "Okay", click: function() { $( this ).dialog( "close" ); } } ],	
		});
	}

	function onContextPreviousVersionsClick(file) {
		status.loading("Retrieving file history");
		sendMessage("<getFileHistoryRequest>\n  <id>" + nextRequestId() + "</id>\n  <root>" + root + "</root>\n  <fileHistoryId>" + file.fileHistoryId + "</fileHistoryId>\n</getFileHistoryRequest>");
	}

	function onDatabaseVersionHeaderChange(databaseVersionHeader) {
		status.loading("Updating file tree");
	
		// Clear/Destroy tree, etc.
	
		tree.clear("");
		tree.clear(root);
	
		dateSelected = databaseVersionHeader;
		sendFileTreeRequest(prefix);
	}

	function onError(evt) {
		console.log('ERROR: ' + evt.data);
		status.error("Not connected");
	}

	function sendListWatchesRequest() {
		sendMessage("<listWatchesRequest>\n  <id>" + nextRequestId() + "</id>\n</listWatchesRequest>");
	}

	function sendFileTreeRequest(path) {
		sendMessage("<getFileTreeRequest>\n  <id>" + nextRequestId() + "</id>\n  <root>" + root + "</root>\n  <prefix>" + path + "</prefix>\n  <date>" + dateSelected + "</date>\n</getFileTreeRequest>");
	}

	function sendGetDatabaseVersionHeaders() {
		sendMessage("<getDatabaseVersionHeadersRequest>\n  <id>" + nextRequestId() + "</id>\n  <root>" + root + "</root>\n</getDatabaseVersionHeadersRequest>");
	}

	function sendRestoreRequest(file) {
		sendMessage("<restoreRequest>\n  <id>" + nextRequestId() + "</id>\n  <root>" + root + "</root>\n  <fileHistoryId>" + file.fileHistoryId + "</fileHistoryId>\n  <version>" + file.version + "</version>\n</restoreRequest>");
	}

	function sendGetFileRequest(file) {
		sendMessage("<getFileRequest>\n  <id>" + nextRequestId() + "</id>\n  <root>" + root + "</root>\n  <fileHistoryId>" + file.fileHistoryId + "</fileHistoryId>\n  <version>" + file.version + "</version>\n</getFileRequest>");
	}

	function setGuiConnected(isConnected) {
		if (isConnected) {
			status.okay('Connected');
		}
		else {
			status.error('Not connected');
		}
	}
}

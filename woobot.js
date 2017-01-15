var WebSocketClient = require('websocket').client;
var request = require('request');
var chalk = require('chalk');
var readline = require('readline');
var open = require('open');
var fs = require('fs');

const DEBUG_RECEIVE = false;
const DEBUG_SEND = false;
const AUTO_RESTART = true;

const COOKIE_URI = 'https://wootalk.today/';
const WS_URI = 'wss://wootalk.today/websocket';
const WS_ORIGIN = 'https://wootalk.today';
const CONFIG_FILE_NAME = 'config.json';

var talks = [];
var config = readConfig();

readline.createInterface({
	input: process.stdin,
	output: process.stdout
}).on('line', (input) => {
	if (input == 'init') {
		restart();
	} else if (input.startsWith('end')) {
		if (input == 'end') {
			endAll();
		} else if (input == 'end ws0') {
			end(0);
		} else if (input == 'end ws1') {
			end(1);
		} 
	} else if (input.startsWith('ws')) {
		if (input.startsWith('ws0 ')) {
			var msg = input.replace('ws0 ', '');
			printMessage(0, msg);
		} else if (input.startsWith('ws1 ')) {
			var msg = input.replace('ws1 ', '');
			printMessage(1, msg);
		}
	}
});

process.stdin.resume();
process.on('SIGINT', function () {
	end();
	process.exit();
});

init();

function init() {
	talks[0] = {};
	talks[1] = {};
	initClient(0);
}

function restart() {
	endAll();
	initClient(0);
}

function initClient(wsIndex) {
	talks[wsIndex].draft = [];
	if (wsIndex == 0) {
		print('------------------------------');
	}
	if (!('cookies' in config)) {
		config['cookies'] = [];
	}
	if (config['cookies'][wsIndex]) {
		initTalk(wsIndex);
	} else {
		request(COOKIE_URI, function (error, response, body) {
			if (!error && response.statusCode == 200) {
				var cookie = response.headers['set-cookie'];
				print('取得 cookie：' + JSON.stringify(cookie), 0, wsIndex);
				config['cookies'][wsIndex] = cookie;
				saveConfig();
				initTalk(wsIndex);
			}
		});
	}
}

function readConfig() {
	try {
		var fileData = fs.readFileSync(CONFIG_FILE_NAME);
		var config = JSON.parse(fileData);
		print("已讀取設定檔");
		return config;
	} catch(err) {
		print("沒有設定檔");
		return {};
	}
}

function saveConfig() {
	fs.writeFile(CONFIG_FILE_NAME, JSON.stringify(config, null, 4), function(err) {
		if (err) {
			print(err);
		}
		print("已儲存設定檔");
	}); 
}

function initTalk(wsIndex) {
	var ws = new WebSocketClient();

	ws.on('connectFailed', function(error) {
		print('連線失敗 - ' + error.toString(), 0, wsIndex);
	});

	ws.on('connect', function(connection) {
		print('連線已開啟', 0, wsIndex);

		talks[wsIndex].connection = connection;
		talks[wsIndex].chatStarted = false;
		talks[wsIndex].lastId = -1;
		talks[wsIndex].instanceCount = 1;

		connection.on('error', function(error) {
			print('連線錯誤 - ' + error.toString(), 0, wsIndex);
		});
		connection.on('close', function() {
			print('連線已關閉', 0, wsIndex);
		});
		connection.on('message', function(message) {
			if (message.type === 'utf8') {
				onMessage(wsIndex, message.utf8Data);
			} else {
				print('未知訊息格式：' + message.type, 0, wsIndex);
			}
		});
	});

	var cookie = config['cookies'][wsIndex];
	var headers = {
		'Accept-Encoding': 'gzip, deflate, sdch',
		'Accept-Language': 'zh-TW,zh;q=0.8,en-US;q=0.6,en;q=0.4',
		'Cache-Control': 'no-cache',
		'Connection': 'Upgrade',
		'Cookie': cookie,
		'Host': 'wootalk.today',
		'Origin': 'https://wootalk.today',
		'Pragma': 'no-cache',
		'Sec-WebSocket-Version': '13',
		'Upgrade': 'websocket',
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64)'
	}

	ws.connect(WS_URI, null, WS_ORIGIN, headers);
}

function onMessage(wsIndex, data) {
	var msg = JSON.parse(data)[0];
	var type = msg[0];
	var data = msg[1].data;
	switch (type) {
		case 'client_connected': {
			print('已連接', 0, wsIndex);
		}
		break;
		case 'new_message': {
			if (Array.isArray(data)) {
				for (item of data) {
					parseMessage(wsIndex, item);
				}
			} else {
				parseMessage(wsIndex, data);
			}
		}
		break;
	}
}

function parseMessage(wsIndex, msg) {
	if (DEBUG_RECEIVE) {
		print(wsIndex + ' received: ' + JSON.stringify(msg));
	}
	if ('status' in msg) {
		switch (msg.status) {
			case 'chat_botcheck': {
				onBotCheck(wsIndex, msg.message);
			}
			break;
			case 'chat_otherleave':{
				print('已離開', 0, wsIndex);
				if (AUTO_RESTART) {
					restart();
				} else {
					end(wsIndex);
				}
			}
			break;
			case 'chat_started': {
				var talk = talks[wsIndex];
				if (!talk.chatStarted) {
					// Start chat
					print('找到對象', 0, wsIndex);
					talk.chatStarted = true;
					for (draftItem of talk.draft) {
						send(wsIndex, draftItem);
					}
					if (wsIndex == 0) {
						initClient(1);
					}
				} else {
					// Duplicated websocket
					print('Websocket duplication: ' + (++talk.instanceCount), 0, wsIndex);
				}
			}
			break;
		}
	} else if ('sender' in msg && msg.sender == 2) {
		// Incoming message
		var msgId = msg['id'];
		if (msgId > talks[wsIndex].lastId) {
			talks[wsIndex].lastId = msgId;
			var messageContent = msg['message'];
			printMessage(wsIndex, messageContent);
			sendMessage(wsIndex == 0 ? 1 : 0, messageContent);
		}
	}
}

function printMessage(wsIndex, messageContent) {
	print('「' + messageContent + '」', 1, wsIndex);
}

function changePerson(wsIndex, callback) {
	send(wsIndex, '["change_person", {}]');
}

function onBotCheck(wsIndex, msg) {
	var startPattern = '<a href="';
	var startIndex = msg.indexOf(startPattern) + startPattern.length;
	var endIndex = msg.indexOf('"', startIndex);
	var url = msg.substring(startIndex, endIndex);
	print('網頁認證 ' + url, 0, wsIndex);
	open(url);
}

function sendMessage(wsIndex, content) {
	send(wsIndex, '["new_message",{"id":1,"data":{"message":"'+ content +'","msg_id":"1"}}]');
}

function send(wsIndex, msg) {
	var talk = talks[wsIndex];
	var connection = talk.connection;
	if (connection && !connection.closeDescription) {
		connection.sendUTF(msg);
		if (DEBUG_SEND) {
			print(wsIndex + ' send: ' + msg);
		}
	} else if (talk.draft) {
		talk.draft.push(msg);
		if (DEBUG_SEND) {
			print(wsIndex + ' add to draft: ' + msg);
		}
	}
}

function endAll() {
	end(0);
	end(1);
}

function end(wsIndex) {
	changePerson(wsIndex);
	closeConnection(wsIndex);
}

function closeConnection(wsIndex) {
	var connection = talks[wsIndex].connection;
	if (connection && !connection.closeDescription) {
		connection.close();
	}
}

function print(content, highlight, wsIndex) {
	var name;
	var style;
	if (wsIndex == 0) {
		style = chalk.cyan;
		name = 'ws0: ';
	} else if (wsIndex == 1) {
		style = chalk.yellow;
		name = 'ws1: ';
	} else {
		style = chalk.white;
		name = '';
	} 
	if (highlight) {
		style = style.bold;
	}
	console.log(style(name + content));
}
var WebSocketClient = require('websocket').client;
var request = require('request');
var chalk = require('chalk');
var readline = require('readline');
var open = require('open');
var fs = require('fs');

// Settings
var AUTO_RESTART = true;
const CHAT_KEY = '';

// Debug messages
const PRINT_EVENTS = false;
const DEBUG_CALLS = false;
const DEBUG_DUPLICATION = false;
const DEBUG_LARGE_DUPLICATION = true;
const DEBUG_LARGE_DUPLICATION_THRESHOLD = 4;
const DEBUG_DRAFT = false;
const DEBUG_SEND = false;
const DEBUG_RECEIVE = false;
const DEBUG_UPDATE_STATE = false;
const DEBUG_PING = false;

const COOKIE_URI = 'https://wootalk.today/';
const WS_URI = 'wss://wootalk.today/websocket';
const WS_ORIGIN = 'https://wootalk.today';
const CONFIG_FILE_NAME = 'config.json';

var talks = [{}, {}];
var recoverFlag = [false, false];
var config = readConfig();

readline.createInterface({
	input: process.stdin,
	output: process.stdout
}).on('line', (input) => {
	if (input == 'init') {
		restart();
	} else if (input.startsWith('ar')) {
		if (input == 'ar1') {
			AUTO_RESTART = true;
			print('開啟自動重啟');
		} else if (input == 'ar0') {
			AUTO_RESTART = false;
			print('關閉自動重啟');
		}
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
			sendMessage(0, msg);
			printMessage(0, msg);
		} else if (input.startsWith('ws1 ')) {
			var msg = input.replace('ws1 ', '');
			sendMessage(1, msg);
			printMessage(1, msg);
		}
	}
});

process.stdin.resume();
process.on('SIGINT', function () {
	endAll();
	process.exit();
});

init();

function init() {
	printStartMessage();
	initClient(0);
}

function restart() {
	endAll();
	init();
}

function printStartMessage() {
	var chatKeyMessage = CHAT_KEY ? CHAT_KEY : "新對話";
	print('\n---------------- ' + chatKeyMessage + ' ----------------');
}

function initClient(wsIndex) {
	if (DEBUG_CALLS) {
		print('initClient ' + wsIndex);
	}

	talks[wsIndex] = {};
	talks[wsIndex].draft = [];

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
		if (PRINT_EVENTS) {
			print("已讀取設定檔");
		}
		return config;
	} catch (err) {
		if (PRINT_EVENTS) {
			print("沒有設定檔");
		}
		return {};
	}
}

function saveConfig() {
	fs.writeFile(CONFIG_FILE_NAME, JSON.stringify(config, null, 4), function (err) {
		if (err) {
			print(err);
		}
		if (PRINT_EVENTS) {
			print("已儲存設定檔");
		}
	});
}

function initTalk(wsIndex) {
	if (DEBUG_CALLS) {
		print('initTalk ' + wsIndex);
	}

	var ws = new WebSocketClient();

	ws.on('connectFailed', function (error) {
		print('連線失敗 - ' + error.toString(), 0, wsIndex);
	});

	ws.on('connect', function (connection) {
		if (PRINT_EVENTS) {
			print('連線已開啟', 0, wsIndex);
		}

		talks[wsIndex].connection = connection;
		talks[wsIndex].lastId = -1;
		talks[wsIndex].instanceCount = 1;
		talks[wsIndex].hasPartner = false;
		talks[wsIndex].isAlive = true;

		connection.on('error', function (error) {
			print('連線錯誤 - ' + error.toString(), 0, wsIndex);
		});
		connection.on('close', function () {
			if (talks[wsIndex].isAlive) {
				print('連線意外關閉', 0, wsIndex);
				talks[wsIndex].isAlive = false;
				// Reconnect
				recoverFlag[wsIndex] = true;
				end(wsIndex);
				initClient(wsIndex);
			} else if (PRINT_EVENTS) {
				print('連線已關閉', 0, wsIndex);
			}
		});
		connection.on('message', function (message) {
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
		'Cookie': cookie + '; _key=' + encodeURI(CHAT_KEY),
		'Host': 'wootalk.today',
		'Origin': 'https://wootalk.today',
		'Pragma': 'no-cache',
		'Sec-WebSocket-Version': '13',
		'Upgrade': 'websocket',
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64)'
	}
	ws.connect(WS_URI, null, WS_ORIGIN, headers);
}

function onMessage(wsIndex, rawMessage) {
	var msg = JSON.parse(rawMessage)[0];
	var type = msg[0];
	var data = msg[1].data;
	switch (type) {
		case 'client_connected': {
			if (recoverFlag[wsIndex]) {
				print('重新連接成功', 0, wsIndex);
			} else if (PRINT_EVENTS) {
				print('已連接', 0, wsIndex);
			}
			break;
		}
		case 'new_message': {
			if (Array.isArray(data)) {
				// Here comes the welcome message or message history
				for (msg of data) {
					var sender = msg.sender;
					if (sender == 0) {
						parseMessage(wsIndex, msg);
					} else if (!recoverFlag[wsIndex]) {
						print('收到歷史記錄，結束前次對話', 0, wsIndex);
						endSession(wsIndex);
						break;
					} else {
						recoverFlag[wsIndex] = false;
						print('恢復對話，忽略歷史記錄', 0, wsIndex);
						break;
					}
				}
			} else {
				recoverFlag[wsIndex] = false;
				parseMessage(wsIndex, data);
			}
			break;
		}
		case 'update_state': {
			var msgString = JSON.stringify(msg)
			if (DEBUG_UPDATE_STATE) {
				print(msgString, 0, wsIndex);
			}
			send(wsIndex == 0 ? 1 : 0, msgString);
			break;
		}
		case 'websocket_rails.ping': {
			if (DEBUG_PING) {
				print(JSON.stringify(msg), 0, wsIndex);
			}
			send(wsIndex, '["websocket_rails.pong",{"id":' + generateId() + ',"data":{}}]');
			break;
		}
	}
}

function parseMessage(wsIndex, msg) {
	var talk = talks[wsIndex];
	if (DEBUG_RECEIVE) {
		print(wsIndex + ' received: ' + JSON.stringify(msg));
	}
	if ('status' in msg) {
		switch (msg.status) {
			case 'chat_botcheck': {
				onBotCheck(wsIndex, msg.message);
				break;
			}
			case 'chat_otherleave': {
				if (PRINT_EVENTS || AUTO_RESTART) {
					print('已離開', 0, wsIndex);
				}
				talk.hasPartner = false;
				endSession(wsIndex);
				break;
			}
			case 'chat_finding': {
				if (PRINT_EVENTS) {
					print('正在尋找對象……', 0, wsIndex);
				}
				break;
			}
			case 'chat_started': {
				if (!talk.hasPartner) {
					// Start chat
					if (PRINT_EVENTS) {
						print('找到對象', 0, wsIndex);
					}
					talk.hasPartner = true;
					for (draftItem of talk.draft) {
						sendMessage(wsIndex, draftItem);
						if (DEBUG_DRAFT) {
							print(wsIndex + ' send from draft: ' + draftItem);
						}
					}
					talk.draft = [];
					if (wsIndex == 0 && !talks[1].isAlive) {
						initClient(1);
					}
				} else {
					// Duplicated websocket
					talk.instanceCount += 1;
					if (DEBUG_DUPLICATION || (DEBUG_LARGE_DUPLICATION && talk.instanceCount >= DEBUG_LARGE_DUPLICATION_THRESHOLD)) {
						print('重複的連線：' + talk.instanceCount, 0, wsIndex);
					}
				}
				break;
			}
		}
	} else if ('sender' in msg && msg.sender == 2) {
		// Incoming message
		var msgId = msg['id'];
		if (msgId > talks[wsIndex].lastId) {
			talks[wsIndex].lastId = msgId;
			var messageContent = msg['message'];
			printMessage(wsIndex, messageContent);
			if (messageContent.includes("sexykatty")) {
				endSession(wsIndex)
			} else {
				sendMessage(wsIndex == 0 ? 1 : 0, messageContent);
			}
		}
	}
}

function printMessage(wsIndex, messageContent) {
	print('「' + messageContent + '」', 1, wsIndex);
}

function endSession(wsIndex) {
	if (talks[wsIndex].isAlive) {
		if (AUTO_RESTART) {
			restart();
		} else {
			end(wsIndex);
		}
	}
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
	var talk = talks[wsIndex];
	if (talk.isAlive) {
		send(wsIndex, '["new_message",{"id":' + generateId() + ',"data":{"message":"' + content + '","msg_id":"1"}}]');
	} else if (talk.draft) {
		talk.draft.push(content);
		if (DEBUG_SEND || DEBUG_DRAFT) {
			print(wsIndex + ' add to draft: ' + content);
		}
	}
}

function send(wsIndex, msg) {
	var talk = talks[wsIndex];
	var connection = talk.connection;
	if (talk.isAlive) {
		connection.sendUTF(msg);
		if (DEBUG_SEND) {
			print(wsIndex + ' send: ' + msg);
		}
	}
}

function endAll() {
	end(0);
	end(1);
}

function end(wsIndex) {
	if (DEBUG_CALLS) {
		print('end ' + wsIndex);
	}
	changePerson(wsIndex);
	var talk = talks[wsIndex];
	talk.hasPartner = false;
	talk.isAlive = false;

	var connection = talks[wsIndex].connection;
	if (connection && !connection.closeDescription) {
		connection.close();
	}
}

function generateId() {
	return Math.floor(Math.random() * 65536);
};

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
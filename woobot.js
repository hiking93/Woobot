var WebSocketClient = require('websocket').client;
var request = require('request');
var chalk = require('chalk');
var readline = require('readline');
var open = require('open');
var fs = require('fs');

const cookieUri = 'https://wootalk.today/';
const wsUri = 'wss://wootalk.today/websocket';
const configFileName = 'config.json';

var talks = [];
var config = readConfig();

readline.createInterface({
	input: process.stdin,
	output: process.stdout
}).on('line', (input) => {
	if (input == 'init') {
		restart();
		initClient(0);
	}
});

init();

function init() {
	initClient(0);
}

function restart() {
	for (var i = 0; i < 2; i++) {
		changePerson(i);
		var connection = talks[i].connection;
		if (connection) {
			connection.close();
		}
	}
}

function initClient(wsIndex) {
	print('initClient() ' + wsIndex);
	if (!('cookies' in config)) {
		config['cookies'] = [];
	}
	if (config['cookies'][wsIndex]) {
		initTalk(wsIndex);
	} else {
		request(cookieUri, function (error, response, body) {
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
		var fileData = fs.readFileSync(configFileName);
		var config = JSON.parse(fileData);
		print("已讀取設定檔");
		return config;
	} catch(err) {
		print("沒有設定檔");
		return {};
	}
}

function saveConfig() {
	fs.writeFile(configFileName, JSON.stringify(config, null, 4), function(err) {
		if (err) {
			print(err);
		}
		print("已儲存設定檔");
	}); 
}

function initTalk(wsIndex) {
	talks[wsIndex] = {};
	var ws = new WebSocketClient();

	ws.on('connectFailed', function(error) {
		print('連線失敗 - ' + error.toString(), 0, wsIndex);
	});

	ws.on('connect', function(connection) {
		print('連線已開啟', 0, wsIndex);

		talks[wsIndex].connection = connection;

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
				print('Unexpected type: ' + message.type, 0, wsIndex);
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

	ws.connect('wss://wootalk.today/websocket', null, 'https://wootalk.today', headers);
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
	if ('status' in msg) {
		switch (msg.status) {
			case 'chat_botcheck': {
				onBotCheck(wsIndex, msg.message);
			}
			break;
			case 'chat_otherleave':{
				print('已離線', 0, wsIndex);
				changePerson(wsIndex);
			}
			break;
			case 'chat_started': {
				print('找到對象', 0, wsIndex);
				sendMessage(wsIndex, "你好");
				if (wsIndex == 0) {
					initClient(1);
				}
			}
			break;
		}
	} else if ('sender' in msg && msg.sender == 2) {
		// Incoming message
		print(wsIndex + ' received: ' + JSON.stringify(msg));

		var messageContent = msg['message'];
		print('「' + messageContent + '」', 1, wsIndex);
		sendMessage(wsIndex == 0 ? 1 : 0, messageContent);
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
	send(wsIndex, '["new_message",{"id":1,"data":{"message":"'+ content +'","msg_id":"1"}}]');
}

function send(wsIndex, msg) {
	var connection = talks[wsIndex].connection;
	if (connection) {
		print(wsIndex + ' sending: ' + msg);
		connection.sendUTF(msg);
	} else {
		print(wsIndex + ' not yet ready: ' + msg);
	}
}

function print(content, highlight, wsIndex) {
	var name;
	var style;
	if (wsIndex == 0) {
		style = chalk.blue;
		name = 'ws0: ';
	} else if (wsIndex == 1) {
		style = chalk.green;
		name = 'ws1: ';
	} else {
		style = chalk.white;
		name = '';
	} 
	if (!highlight) {
		style = style.dim;
	}
	console.log(style(name + content));
}
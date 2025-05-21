import { type } from 'arktype';

const delay = (t: number) => {
	return new Promise((r) => {
		setTimeout(() => {
			r(true);
		}, t);
	});
};

const BiliLiveRes = type({
	code: 'number',
	message: 'string',
	data: {
		'[string]': {
			title: 'string',
			room_id: 'number',
			uid: 'number',
			online: '0 | 1',
			live_time: 'number',
			live_status: '0 | 1',
			area_name: 'string',
			uname: 'string',
			face: 'string',
		},
	},
});

type BiliLiveResType = typeof BiliLiveRes.infer;

export function wechatNotify(title: string, content: string, env: Env) {
	const url = 'https://wxpusher.zjiecode.com/api/send/message';
	const data = {
		appId: Number(env.WX_PUSHER_APPID),
		appToken: env.WX_PUSHER_APP_TOKEN,
		uids: [env.WX_PUSHER_USER_ID],
		topicIds: [],
		// url: process.env.run_url,
		summary: title,
		content,
		contentType: 2,
		verifyPay: false,
	};

	const headers = {
		Accept: '*/*',
		'Cache-Control': 'no-cache',
		'Content-Type': 'application/json;charset=utf-8',
		Pragma: 'no-cache',
	};

	return fetch(url, {
		method: 'POST',
		headers: headers,
		body: JSON.stringify(data),
	});
}

export async function wechatNotify2(title: string, content: string, env: Env) {
	// https://sctapi.ftqq.com/****************.send
	const res: {
		code: number;
		message: string;
		data?: {
			pushid: string;
			readkey: string;
		};
	} = await fetch(`https://sctapi.ftqq.com/${env.FT_SEND_KEY}.send`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json;charset=utf-8',
		},
		body: JSON.stringify({
			title,
			desp: content,
		}),
	}).then((r) => r.json());
	if (res.code !== 0) {
		throw new Error('failed to send wechat ' + res.code + ':' + res.message);
	}
	await delay(3000);
	const status: {
		code: number;
		message: string;
		data: { id: number; wxstatus: '' };
	} = await fetch(`https://sctapi.ftqq.com/push?id=${res.data!.pushid}&readkey=${res.data!.readkey}`).then((r) => r.json());

	if (status.code === 0 && status.data.wxstatus) {
		const wxstatus = JSON.parse(status.data.wxstatus);
		if (wxstatus.errcode === 0) {
			return Response.json({
				success: true,
			});
		}
	}
	throw new Error('failed to get wechat notify status');
}

// 存储数据 https://www.npoint.io/docs/NPOINT_ID
// async function saveToNpoint(data: any, env: Env) {
// 	const response = await fetch('https://api.npoint.io/' + env.NPOINT_ID, {
// 		method: 'POST',
// 		headers: { 'Content-Type': 'application/json' },
// 		body: JSON.stringify(data),
// 	});
// 	return response.json();
// }

// // 读取数据
// async function readFromNpoint(env: Env): Promise<{
// 	livingUps: Record<string, { uname: string; title: string; roomId: number }>;
// }> {
// 	const response = await fetch('https://api.npoint.io/' + env.NPOINT_ID);
// 	return response.json();
// }

// https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids?uids[]=1625060795&uids[]=69857763

interface LiveUp {
	uname: string;
	title: string;
	roomId: number;
}

let currentLivingUps: Record<string, LiveUp> = {};

async function requestBili(url: string): Promise<BiliLiveResType> {
	// const aa = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
	const aa = `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`;
	// https://api.allorigins.win/raw?url=https%3A%2F%2Fapi.live.bilibili.com%2Froom%2Fv1%2FRoom%2Fget_status_info_by_uids%3Fuids%5B%5D%3D1625060795%26_t%3D1730117790491
	const response = await fetch(aa, {
		headers: {
			accept: 'application/json,*/*',
			'cache-control': 'no-cache',
			'upgrade-insecure-requests': '1',
			'user-agent':
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
		},
		body: null,
		method: 'GET',
	});
	if (!response.ok || response.status !== 200) {
		throw new Error('http status is not 200 but ' + response.status);
	}
	return response.json();
}

export async function checkLive(env: Env) {
	const id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName('bili-live');
	const stub = env.MY_DURABLE_OBJECT.get(id);
	const uidsStr = await env.KV_BILI_LIVE.get('up_ids');
	const uids = uidsStr
		?.split(',')
		.map((id) => `uids[]=${id}`)
		.join('&');
	if (!uids) {
		return null;
	}
	// const uids = env.BILI_UPS.split(',')
	// 	.map((id) => `uids[]=${id}`)
	// 	.join('&');
	// https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids?uids[]=1625060795
	const url = `https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids?${uids}&_t=${Date.now()}`;
	let biliRes: BiliLiveResType | null = null;
	let biliErr = null;
	for (let i = 0; i < 3; i++) {
		try {
			biliRes = await requestBili(url);
			const validate = BiliLiveRes(biliRes);
			// console.log(biliRes, validate);
			if (validate instanceof type.errors) {
				// hover out.summary to see validation errors
				throw new Error(`bili live check res not match schema, ${validate.summary}`);
			} else {
				break;
			}
		} catch (err: any) {
			biliErr = err;
			await delay(2 ** i * 1500);
		}
	}
	if (!biliRes) {
		throw new Error(`proxy bili api failed, ${biliErr}`);
	}
	if (biliRes.code !== 0) {
		throw new Error('bili api code is not 0 but ' + biliRes.code + ':' + biliRes.message);
	}
	let hasNewLiveUp = false;
	let hasChanged = false;

	currentLivingUps = await stub.getData('liveUps', {});

	const keys = Object.keys(biliRes.data);
	for (const mid of keys) {
		const { live_status, uname, title, room_id } = biliRes.data[mid];
		if (live_status === 1) {
			if (!(mid in currentLivingUps)) {
				hasNewLiveUp = true;
				currentLivingUps[mid] = {
					uname,
					title,
					roomId: room_id,
				};
				hasChanged = true;
			}
		} else if (mid in currentLivingUps) {
			delete currentLivingUps[mid];
			hasChanged = true;
		}
	}

	if (hasNewLiveUp) {
		const livings: string[] = [];
		for (const mid in currentLivingUps) {
			const { uname, roomId, title } = currentLivingUps[mid];
			livings.push(`- **${uname}** 正在直播：[${title || '点击查看'}](https://live.bilibili.com/h5/${roomId})`);
		}
		await wechatNotify2(`有${livings.length}位UP正在直播`, [...livings, '', '**🌼记得开直播录制**'].join('\n'), env);

		// await wechatNotify2(`有${livings.length}位UP正在直播`, `<ul>${livings.join('')}</ul><p>🌼记得开直播录制</p>`, env);
	}

	if (hasChanged) {
		await stub.setData('liveUps', { ...currentLivingUps });
		// await saveToNpoint(currentLivingUps, env);
	}
	return currentLivingUps;
}

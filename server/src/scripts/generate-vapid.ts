import webpush from 'web-push';

/** VAPID 키쌍 생성 → .env 에 붙여넣을 형태로 출력. */
const keys = webpush.generateVAPIDKeys();
console.log('\n아래 두 줄을 .env 에 붙여넣으세요:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}\n`);

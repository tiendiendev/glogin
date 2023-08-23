import Gologin from 'tdgologin';

class Glogin {
    constructor(tokenApi, pathFolderProfiles) {
        this.token = tokenApi;
        this.tmpdir = pathFolderProfiles;
    }
    async newProfile(os, profileName, userAgent) {
        const GL = new Gologin({
            token: this.token,
            tmpdir: this.tmpdir,
        });
        if (os == "win" || os == "mac" || os == "lin") {
            var windows_sizes = ["1152x648", "1152x864", "1280x720", "1280x768", "1280x800", "1280x960", "1280x1024", "1360x768", "1366x768", "1400x1050", "1440x900", "1440x1080", "1536x864", "1600x900", "1600x1200", "1680x1050", "1856x1392", "1920x1080", "1920x1200", "1920x1440"];
        } else {
            var windows_sizes = ["393x873", "360x760", "384x832", "384x854", "412x915", "393x851", "384x896", "412x892"];
        }
        // Lấy số ngẫu nhiên trong khoảng từ 0 đến độ dài của mảng
        var randomIndex = Math.floor(Math.random() * windows_sizes.length);
        // Lấy phần tử ngẫu nhiên từ mảng
        var windows_size = windows_sizes[randomIndex];
        const profile_id = await GL.create({
            'name': profileName,
            'os': os, // 'win', 'lin', 'android'
            // isM1: true, // for Mac M1
            'navigator': {
                'autoLang': true,
                'language': 'en-US,en;q=0.9',
                'userAgent': userAgent, // get random user agent for selected os
                'resolution': windows_size,
            },
            'audioContext': {
                "mode": "noise",
                "noise": 0
            },
            'canvas': {
                "mode": "noise",
                "noise": 0
            },
            'webGL': {
                "mode": "noise",
                "getClientRectsNoise": 0,
                "noise": 0
            },
            'clientRects': {
                "mode": "noise",
                "noise": 0
            },
            'timezone': {
                "enabled": true,
                "fillBasedOnIp": true,
                "timezone": "string"
            },
            'proxyEnabled': false,
            'proxy': {
                'mode': 'none',
            },
        });

        console.log('profile id=', profile_id);

        await GL.update({
            'id' : profile_id,
            'name' : 'profile_mac2',
        });
        return profile_id;
    }

    async downloadProfile(profile_id) {
        const GL = new Gologin({
            token: this.token,
            tmpdir: this.tmpdir,
            profile_id: profile_id,
        });
        try {
            const {
                status
            } = await GL.start();
            if (status !== 'success') {
                console.log('Invalid status');
            }
        } catch (error) {
            console.trace(error);
            console.log('Failed to start profile:', error.message);
        }
    }
}



// cách dùng
const apiKey = "xxxxxx";
const pathProfiles = "C:\\Users\\Desktop\\testp";
const os = "win";
const profileName = "WIn_Abc";
const userAgent = "random";
const gloginInstance = new Glogin(apiKey, pathProfiles);
(async() => {
    const profileId = await gloginInstance.newProfile(os, profileName, userAgent);
    await gloginInstance.downloadProfile(profileId);
})();
import { exec as execNonPromise } from 'child_process';
import decompress from 'decompress';
import decompressUnzip from 'decompress-unzip';
import { createWriteStream, promises as _promises } from 'fs';
import { get } from 'https';
import { homedir } from 'os';
import { join } from 'path';
import ProgressBar from 'progress';
import { createInterface } from 'readline';
import util from 'util';

import { findLatestBrowserVersionDirectory } from '../utils/utils.js';

const exec = util.promisify(execNonPromise);
const { access, mkdir, readdir, rmdir, unlink, copyFile, readlink, symlink, lstat } = _promises;

const PLATFORM = process.platform;

const VERSION_FILE = 'latest-version.txt';
const MAC_VERSION_FILE_URL = `https://orbita-browser-mac.gologin.com/${VERSION_FILE}`;
const DEB_VERSION_FILE_URL = `https://orbita-browser-linux.gologin.com/${VERSION_FILE}`;
const WIN_VERSION_FILE_URL = `https://orbita-browser-windows.gologin.com/${VERSION_FILE}`;

const WIN_FOLDERSIZE_FILE = 'foldersize.txt';
const WIN_FOLDERSIZE_FILE_LINK = `https://orbita-browser-windows.gologin.com/${WIN_FOLDERSIZE_FILE}`;

const BROWSER_ARCHIVE_NAME = `orbita-browser-latest.${PLATFORM === 'win32' ? 'zip' : 'tar.gz'}`;
const MAC_BROWSER_LINK = `https://orbita-browser-mac.gologin.com/${BROWSER_ARCHIVE_NAME}`;
const DEB_BROWSER_LINK = `https://orbita-browser-linux.gologin.com/${BROWSER_ARCHIVE_NAME}`;
const WIN_BROWSER_LINK = `https://orbita-browser-windows.gologin.com/${BROWSER_ARCHIVE_NAME}`;

const MAC_HASH_FILE = 'hashfile.mtree';
const DEB_HASH_FILE = 'hashfile.txt';
const WIN_HASH_FILE = DEB_HASH_FILE;
const MAC_HASHFILE_LINK = `https://orbita-browser-mac.gologin.com/${MAC_HASH_FILE}`;
const DEB_HASHFILE_LINK = `https://orbita-browser-linux.gologin.com/${DEB_HASH_FILE}`;
const WIN_HASHFILE_LINK = `https://orbita-browser-windows.gologin.com/${WIN_HASH_FILE}`;

const FAIL_SUM_MATCH_MESSAGE = 'hash_sum_not_matched';
const EXTRACTED_FOLDER = 'extracted-browser';

export class BrowserChecker {
  #homedir;
  #browserPath;
  #executableFilePath;
  #skipOrbitaHashChecking = false;

  constructor(skipOrbitaHashChecking) {
    this.#skipOrbitaHashChecking = skipOrbitaHashChecking;
    this.#homedir = homedir();
    this.#browserPath = join(this.#homedir, '.gologin', 'browser');

    let executableFilePath = join(this.#browserPath, 'orbita-browser', 'chrome');
    if (PLATFORM === 'darwin') {
      const orbitaFolderName = findLatestBrowserVersionDirectory(this.#browserPath);
      if (orbitaFolderName === 'error') {
        throw Error('Orbita folder not found in this directory: ' + this.#browserPath);
      }

      executableFilePath = join(this.#browserPath, orbitaFolderName, 'Orbita-Browser.app', 'Contents', 'MacOS', 'Orbita');
    } else if (PLATFORM === 'win32') {
      executableFilePath = join(this.#browserPath, 'orbita-browser', 'chrome.exe');
    }

    this.#executableFilePath = executableFilePath;
    // console.log('executableFilePath:', executableFilePath);
  }

  async checkBrowser(autoUpdateBrowser = false) {
    const browserFolderExists = await access(this.#executableFilePath).then(() => true).catch(() => false);

    if (!browserFolderExists) {
      return this.downloadBrowser();
    }

    const browserLatestVersion = await this.getLatestBrowserVersion();
    const currentVersionReq = await this.getCurrentVersion();
    const currentVersion = (currentVersionReq?.stdout || '').replace(/(\r\n|\n|\r)/gm, '');

    if (browserLatestVersion === currentVersion) {
      return;
    }

    if (autoUpdateBrowser) {
      return this.downloadBrowser();
    }

    return new Promise(resolve => {
      const rl = createInterface(process.stdin, process.stdout);
      const timeout = setTimeout(() => {
        console.log(`\nContinue with current ${currentVersion} version.`);
        resolve();
      }, 10000);

      rl.question(`New Orbita ${browserLatestVersion} is available. Update? [y/n] `, (answer) => {
        clearTimeout(timeout);
        rl.close();
        if (answer && answer[0].toString().toLowerCase() === 'y') {
          return this.downloadBrowser().then(() => resolve());
        }

        console.log(`Continue with current ${currentVersion} version.`);
        resolve();
      });
    });
  }

  async downloadBrowser() {
    await this.deleteOldArchives(true);
    await mkdir(this.#browserPath, { recursive: true });

    const pathStr = join(this.#browserPath, BROWSER_ARCHIVE_NAME);
    let link = DEB_BROWSER_LINK;
    if (PLATFORM === 'win32') {
      link = WIN_BROWSER_LINK;
    } else if (PLATFORM === 'darwin') {
      link = MAC_BROWSER_LINK;
    }

    await this.downloadBrowserArchive(link, pathStr);
    await this.checkBrowserArchive(pathStr);
    await this.extractBrowser();
    await this.checkBrowserSum();
    console.log('Orbita hash checked successfully');
    await this.replaceBrowser();
    await this.deleteOldArchives();
    console.log('Orbita updated successfully');
  }

  downloadBrowserArchive(link, pathStr) {
    return new Promise((resolve, reject) => {
      const writableStream = createWriteStream(pathStr);
      writableStream.on('error', async err => {
        await unlink(pathStr);
        reject(err);
      });
      writableStream.on('finish', () => resolve());

      const req = get(link, {
        timeout: 15 * 1000,
      }, (res) => {
        const len = parseInt(res.headers['content-length'], 10);
        const formattedLen = len / 1024 / 1024;
        const bar = new ProgressBar('Orbita downloading [:bar] :rate/mps :downloadedMb/:fullMbMB :percent :etas', {
          complete: '=',
          incomplete: ' ',
          width: 30,
          total: Math.round(formattedLen),
        });

        let downloadedMb = 0;

        res.on('data', (chunk) => {
          const formattedChunckLenght = chunk.length / 1024 / 1024;
          downloadedMb += formattedChunckLenght;
          bar.tick(formattedChunckLenght, {
            fullMb: formattedLen.toFixed(2),
            downloadedMb: downloadedMb.toFixed(2),
          });
        });

        res.on('end', () => {
          bar.tick(bar.total, {
            fullMb: formattedLen.toFixed(2),
            downloadedMb: formattedLen.toFixed(2),
          });
          console.log('\nDownload completed');
          writableStream.end();
        });

        res.pipe(writableStream);
      });

      req.on('error', (err) => writableStream.destroy(err));
      req.end();
    });
  }

  async checkBrowserArchive(pathStr) {
    console.log('Checking Orbita archive');
    try {
      await access(pathStr);
    } catch (e) {
      throw new Error('Archive has not been found. Please run script again.');
    }
  }

  async extractBrowser() {
    console.log('Extracting Orbita');
    await mkdir(join(this.#browserPath, EXTRACTED_FOLDER), { recursive: true });
    if (PLATFORM === 'win32') {
      return decompress(join(this.#browserPath, BROWSER_ARCHIVE_NAME), join(this.#browserPath, EXTRACTED_FOLDER),
        {
          plugins: [decompressUnzip()],
          filter: file => !file.path.endsWith('/'),
        },
      );
    }

    return exec(
      `tar xzf ${join(this.#browserPath, BROWSER_ARCHIVE_NAME)} --directory ${join(this.#browserPath, EXTRACTED_FOLDER)}`,
    );
  }

  async downloadHashFile() {
    let hashLink = DEB_HASHFILE_LINK;
    let resultPath = join(this.#browserPath, DEB_HASH_FILE);
    if (PLATFORM === 'darwin') {
      hashLink = MAC_HASHFILE_LINK;
      resultPath = join(this.#browserPath, MAC_HASH_FILE);
    }

    const writableStream = createWriteStream(resultPath);
    writableStream.on('error', async (err) => {
      await unlink(resultPath);
      throw err;
    });

    await new Promise(resolve => get(hashLink,
      {
        timeout: 10 * 1000,
      }, (res) => {
        res.on('end', () => {
          console.log('Hashfile downloading completed');
          writableStream.end();
          resolve();
        });

        res.pipe(writableStream);
      }).on('error', (err) => writableStream.destroy(err)));

    const hashFile = PLATFORM === 'darwin' ? MAC_HASH_FILE : DEB_HASH_FILE;
    const hashFilePath = join(this.#browserPath, hashFile);

    return access(hashFilePath);
  }

  async checkBrowserSum() {
    if (this.#skipOrbitaHashChecking) {
      return Promise.resolve();
    }

    console.log('Orbita hash checking');
    if (PLATFORM === 'win32') {
      return Promise.resolve();
    }

    await this.downloadHashFile();
    if (PLATFORM === 'darwin') {
      const calculatedHash = await exec(
        `mtree -p ${join(this.#browserPath, EXTRACTED_FOLDER, 'Orbita-Browser.app')} < ${join(this.#browserPath, MAC_HASH_FILE)} || echo ${FAIL_SUM_MATCH_MESSAGE}`,
      );

      const checkedRes = (calculatedHash || '').toString().trim();
      if (checkedRes.includes(FAIL_SUM_MATCH_MESSAGE)) {
        throw new Error('Error in sum matching. Please run script again.');
      }

      return;
    }

    const hashFileContent = await exec(`cat ${join(this.#browserPath, DEB_HASH_FILE)}`);
    let serverRes = (hashFileContent.stdout || '').toString().trim();
    serverRes = serverRes.split(' ')[0];

    const calculateLocalBrowserHash = await exec(
      `cd ${join(this.#browserPath, EXTRACTED_FOLDER)} && find orbita-browser -type f -print0 | sort -z | \
            xargs -0 sha256sum > ${this.#browserPath}/calculatedFolderSha.txt`,
    );

    const localHashContent = await exec(`cd ${this.#browserPath} && sha256sum calculatedFolderSha.txt`);
    let userRes = (localHashContent.stdout || '').toString().trim();
    userRes = userRes.split(' ')[0];
    if (userRes !== serverRes) {
      throw new Error('Error in sum matching. Please run script again.');
    }
  }

  async replaceBrowser() {
    console.log('Copy Orbita to target path');
    if (PLATFORM === 'darwin') {
      await this.deleteDir(join(this.#browserPath, 'Orbita-Browser.app'));

      const files = await readdir(join(this.#browserPath, EXTRACTED_FOLDER));
      const promises = [];
      files.forEach((filename) => {
        if (filename.match(/.*\.dylib$/)) {
          promises.push(copyFile(join(this.#browserPath, EXTRACTED_FOLDER, filename), join(this.#browserPath, filename)));
        }
      });

      return Promise.all(promises);
    }

    const targetBrowserPath = join(this.#browserPath, 'orbita-browser');
    await this.deleteDir(targetBrowserPath);

    await this.copyDir(
      join(this.#browserPath, EXTRACTED_FOLDER, 'orbita-browser'),
      targetBrowserPath,
    );
  }

  async deleteOldArchives(deleteCurrentBrowser = false) {
    if (deleteCurrentBrowser) {
      return this.deleteDir(join(this.#browserPath));
    }

    await this.deleteDir(join(this.#browserPath, EXTRACTED_FOLDER));

    return readdir(this.#browserPath)
      .then((files) => {
        const promises = [];
        files.forEach((filename) => {
          if (filename.match(/(txt|dylib|mtree)/)) {
            promises.push(unlink(join(this.#browserPath, filename)));
          }
        });

        return Promise.all(promises);
      })
      .catch(e => {
        console.log(`Error in deleting old archives. ${e.message}`);

        return Promise.resolve();
      });
  }

  async copyDir(src, dest) {
    await mkdir(dest);
    const files = await readdir(src);
    for (let i = 0; i < files.length; i++) {
      const current = await lstat(join(src, files[i]));
      if (current.isDirectory()) {
        await this.copyDir(join(src, files[i]), join(dest, files[i]));
      } else if (current.isSymbolicLink()) {
        const symlinkObj = await readlink(join(src, files[i]));
        await symlink(symlinkObj, join(dest, files[i]));
      } else {
        await copyFile(join(src, files[i]), join(dest, files[i]));
      }
    }
  }

  getCurrentVersion() {
    let command = `if [ -f ${join(this.#browserPath, 'orbita-browser', 'version')} ]; then cat ${join(this.#browserPath, 'orbita-browser', 'version')}; else echo 0.0.0; fi`;
    if (PLATFORM === 'win32') {
      command = `if exist "${join(this.#browserPath, 'orbita-browser', 'version')}" (type "${join(this.#browserPath, 'orbita-browser', 'version')}") else (echo 0.0.0)`;
    } else if (PLATFORM === 'darwin') {
      command = `if [ -f ${join(this.#browserPath, 'version', VERSION_FILE)} ]; then cat ${join(this.#browserPath, 'version', VERSION_FILE)}; else echo 0.0.0; fi`;
    }

    return exec(command);
  }

  getLatestBrowserVersion() {
    let url = DEB_VERSION_FILE_URL;
    if (PLATFORM === 'win32') {
      url = WIN_VERSION_FILE_URL;
    } else if (PLATFORM === 'darwin') {
      url = MAC_VERSION_FILE_URL;
    }

    return new Promise(resolve => get(url,
      {
        timeout: 15 * 1000,
        headers: {
          'Content-Type': 'text/plain',
        },
      }, (res) => {
        res.setEncoding('utf8');

        let resultResponse = '';
        res.on('data', (data) => resultResponse += data);

        res.on('end', () => {
          resolve(resultResponse.trim());
        });
      }).on('error', (err) => resolve('')));
  }

  get getOrbitaPath() {
    return this.#executableFilePath;
  }

  async deleteDir(path = '') {
    if (!path) {
      return;
    }

    const directoryExists = await access(path).then(() => true).catch(() => false);
    if (!directoryExists) {
      return;
    }

    return rmdir(path, { recursive: true });
  }
}

export default BrowserChecker;

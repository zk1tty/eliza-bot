import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// Interface for download options
interface DownloadOptions {
  url: string;
  destinationFolder?: string;
  filename?: string;
}

class ImageDownloader {
  // Method to download image using native Node.js https/http
  static downloadWithNative(options: DownloadOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const { 
        url, 
        destinationFolder = './meme_images', 
        filename = path.basename(new URL(url).pathname)
      } = options;

      // Ensure download directory exists
      if (!fs.existsSync(destinationFolder)) {
        fs.mkdirSync(destinationFolder, { recursive: true });
      }

      const filePath = path.join(destinationFolder, filename);
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (response) => {
        // Check for redirect
        if (response.statusCode === 302 || response.statusCode === 301) {
          return this.downloadWithNative({ 
            ...options, 
            url: response.headers.location || url 
          });
        }

        // Handle non-200 status
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to get '${url}' (${response.statusCode}): ${response.statusMessage}`));
          return;
        }

        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve(filePath);
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  // Method to download image using fetch API (more modern approach)
  static async downloadWithFetch(options: DownloadOptions): Promise<string> {
    const { 
      url, 
      destinationFolder = './meme_images', 
      filename = path.basename(new URL(url).pathname)
    } = options;

    // Ensure download directory exists
    if (!fs.existsSync(destinationFolder)) {
      fs.mkdirSync(destinationFolder, { recursive: true });
    }

    const filePath = path.join(destinationFolder, filename);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (error) {
      throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Example method to download multiple images
  static async downloadMemes(memeUrls: string[]): Promise<string[]> {
    const downloadPromises = memeUrls.map((url, index) => 
      this.downloadWithFetch({
        url, 
        filename: `meme_${index + 1}.jpg`
      })
    );

    return Promise.all(downloadPromises);
  }
}

// Example usage
async function main() {
  const memeUrls = [
    'https://i.imgflip.com/30b1gx.jpg',
    'https://i.imgflip.com/1g8my4.jpg',
    'https://i.imgflip.com/1ur9b0.jpg',
    'https://i.imgflip.com/9au02y.jpg', // Chill guy
    'https://i.imgflip.com/3oevdk.jpg', // Bernie I Am Once Again Asking For Your Support
    'https://i.imgflip.com/3lmzyx.jpg', // UNO Draw 25 Cards
    'https://i.imgflip.com/22bdq6.jpg', // Left Exit 12 Off Ramp
    'https://i.imgflip.com/261o3j.jpg'  // Running Away Balloon
  ];

  try {
    const downloadedFiles = await ImageDownloader.downloadMemes(memeUrls);
    console.log('Downloaded memes:', downloadedFiles);
  } catch (error) {
    console.error('Download failed:', error);
  }
}

// Uncomment to run
main();

export default ImageDownloader;
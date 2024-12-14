// primitive Twitter client
import { Scraper } from "agent-twitter-client";
import fs from 'fs';
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export type { Scraper };

async function exportCookies(scraper: Scraper) {
  try {
    // Add delay before login to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Make sure environment variables are loaded
    if (!process.env.TWITTER_USERNAME || !process.env.TWITTER_PASSWORD) {
      throw new Error('Twitter credentials not found in environment variables');
    }

    // First ensure we're logged out
    await scraper.logout();
    
    // Attempt login with proper error handling
    console.log('Attempting to login...');
    await scraper.login(process.env.TWITTER_USERNAME, process.env.TWITTER_PASSWORD);
    
    // Verify login was successful
    const isLoggedIn = await scraper.isLoggedIn();
    if (!isLoggedIn) {
      throw new Error('Login failed - not logged in after attempt');
    }

    // Get cookies after successful login
    const cookies = await scraper.getCookies();
    console.log("Got cookies:", cookies);

    if (!cookies || cookies.length === 0) {
      throw new Error('No cookies received after login');
    }

    // Save raw cookies first for debugging
    fs.writeFileSync('cookies.raw.json', JSON.stringify(cookies, null, 2));

    // Format cookies as objects with required properties
    const formattedCookies = cookies
      .filter(cookie => cookie && typeof cookie === 'object')
      .map(cookie => ({
        name: cookie.name || cookie.key,
        value: cookie.value,
        domain: '.twitter.com',
        path: '/',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      }));

    if (formattedCookies.length === 0) {
      throw new Error('No valid cookies after formatting');
    }

    fs.writeFileSync('cookies.json', JSON.stringify(formattedCookies, null, 2));
    console.log('Cookies exported successfully');
    
  } catch (error) {
    console.error('Error in exportCookies:', error);
    throw error;
  }
}

// Function to load cookies from the JSON file
async function loadCookies(scraper: Scraper) {
  try {
    const cookiesData = fs.readFileSync('cookies.json', 'utf8');
    const cookies = JSON.parse(cookiesData);

    // Pass cookie objects directly to setCookies
    await scraper.setCookies(cookies);

    const isLoggedIn = await scraper.isLoggedIn();
    if (isLoggedIn) {
      console.log('Cookies loaded and login successful');
    } else {
      console.error("Login failed");
    }
  } catch (error) {
    console.error('Error loading cookies:', error);
  }
}

// Main function to accept user input RL and and post to Twitter
async function main() {
  const scraper = new Scraper();
    
  try{
    // First try to load existing cookies
    try {
      await loadCookies(scraper);
      const isLoggedIn = await scraper.isLoggedIn();
      if (isLoggedIn) {
        console.log('Successfully logged in with existing cookies');
      } else {
        throw new Error('Cookie login failed');
      }
    } catch (error) {
      console.log('Could not login with existing cookies, trying fresh login...');
      await exportCookies(scraper);
    }

    // Verify login status before tweeting
    const loginStatus = await scraper.isLoggedIn();
    if (!loginStatus) {
      throw new Error('Not logged in after all attempts');
    }

    // Accept message input from command line
    rl.question('Enter your tweet message: ', async (message) => {
      // Try to send tweet
      try {
        const sendTweetResults = await scraper.sendTweet(message);
        sendTweetResults?.status == 200 
        && console.log("Tweet sent successfully:", sendTweetResults):'';
      } catch (error) {
        console.error("Error sending tweet:", error);
      } finally {
        rl.close(); // Close the readline interface after sending the tweet
      }
    });

  } catch (error) {
    console.error("Error in main function:", error);
    throw error;
  }
}
  
// Start the application
main().catch((error) => {
    console.error("Error in main function:", error);
});
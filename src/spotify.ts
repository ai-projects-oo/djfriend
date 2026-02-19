import axios from 'axios';

interface SearchResult {
  spotifyId: string;
  artistId: string;
  spotifyArtist: string;
  spotifyTitle: string;
}

export async function authenticate(clientId: string, clientSecret: string): Promise<string> {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  // console.log('Spotify authentication successful', response);
  return response.data.access_token as string;
}

export async function searchTrack(
  artist: string | null,
  title: string,
  token: string
): Promise<SearchResult | null> {
  const query = artist ? `${artist} ${title}` : title;
  const response = await axios.get('https://api.spotify.com/v1/search', {
    params: { q: query, type: 'track', limit: 1 },
    headers: { Authorization: `Bearer ${token}` },
  });

  const items = response.data.tracks?.items;
  if (!items || items.length === 0) return null;

  const track = items[0];
  return {
    spotifyId: track.id,
    artistId: track.artists[0]?.id ?? null,
    spotifyArtist: track.artists[0]?.name ?? '',
    spotifyTitle: track.name,
  };
}

export async function getArtistGenres(artistId: string, token: string): Promise<string[]> {
  const response = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data.genres ?? [];
}

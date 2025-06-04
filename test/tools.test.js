const { sanitizeEpisode, pathToTitle } = require('../lib/helpers');

// Sample test to verify sanitizeEpisode works as expected
it('sanitizeEpisode replaces slashes and spaces', () => {
  const input = 'my/episode name';
  const sanitized = sanitizeEpisode(input);
  expect(sanitized).toBe('my-episode_name');
});

it('pathToTitle converts file path to title', () => {
  const title = pathToTitle('/some/path/My_Audio_File.mp3');
  expect(title).toBe('My Audio File');
});

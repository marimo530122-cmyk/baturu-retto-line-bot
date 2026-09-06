function pickEpisode(episodes) {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const now = new Date();
  const dayOfYear = Math.floor((now - start) / 86400000);
  return episodes[dayOfYear % episodes.length];
}

module.exports = { pickEpisode };

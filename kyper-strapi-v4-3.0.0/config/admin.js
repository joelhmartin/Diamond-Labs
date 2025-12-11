module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET', 'a5fd298bb86ffa71052481f9bb813cfd'),
  },
});

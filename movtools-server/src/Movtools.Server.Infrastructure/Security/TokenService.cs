using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Movtools.Server.Application.Interfaces;
using Movtools.Server.Application.Options;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Security;

public sealed class TokenService : ITokenService
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(12);
    private readonly JwtOptions _options;

    public TokenService(IOptions<JwtOptions> options)
    {
        _options = options.Value;
    }

    public (string Token, DateTimeOffset ExpiresAtUtc) CreateAccessToken(User user, IReadOnlyCollection<string> roles)
    {
        var expiresAtUtc = DateTimeOffset.UtcNow.Add(Lifetime);
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.UserName),
            new(JwtRegisteredClaimNames.UniqueName, user.UserName),
            new("display_name", user.DisplayName)
        };

        claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));

        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: expiresAtUtc.UtcDateTime,
            signingCredentials: credentials);

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAtUtc);
    }
}

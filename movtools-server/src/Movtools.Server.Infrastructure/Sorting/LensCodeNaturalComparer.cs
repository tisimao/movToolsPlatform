using System.Globalization;
using System.Text.RegularExpressions;
using Movtools.Server.Domain.Entities;

namespace Movtools.Server.Infrastructure.Sorting;

public sealed class LensCodeNaturalComparer : IComparer<Lens>
{
    public static LensCodeNaturalComparer Instance { get; } = new();

    private static readonly Regex TokenRegex = new(@"\d+|\D+", RegexOptions.Compiled);

    public int Compare(Lens? x, Lens? y)
    {
        if (ReferenceEquals(x, y))
        {
            return 0;
        }

        if (x is null)
        {
            return -1;
        }

        if (y is null)
        {
            return 1;
        }

        return CompareCode(x.Code, y.Code);
    }

    private static int CompareCode(string? leftCode, string? rightCode)
    {
        var left = leftCode ?? string.Empty;
        var right = rightCode ?? string.Empty;

        var leftTokens = TokenRegex.Matches(left);
        var rightTokens = TokenRegex.Matches(right);
        var count = Math.Min(leftTokens.Count, rightTokens.Count);

        for (var i = 0; i < count; i++)
        {
            var leftToken = leftTokens[i].Value;
            var rightToken = rightTokens[i].Value;

            var leftIsNumber = char.IsDigit(leftToken[0]);
            var rightIsNumber = char.IsDigit(rightToken[0]);

            if (leftIsNumber && rightIsNumber)
            {
                var leftNumber = long.Parse(leftToken, CultureInfo.InvariantCulture);
                var rightNumber = long.Parse(rightToken, CultureInfo.InvariantCulture);

                var numberCompare = leftNumber.CompareTo(rightNumber);
                if (numberCompare != 0)
                {
                    return numberCompare;
                }

                var lengthCompare = leftToken.Length.CompareTo(rightToken.Length);
                if (lengthCompare != 0)
                {
                    return lengthCompare;
                }
            }
            else
            {
                var textCompare = string.Compare(leftToken, rightToken, StringComparison.OrdinalIgnoreCase);
                if (textCompare != 0)
                {
                    return textCompare;
                }
            }
        }

        var tokenCountCompare = leftTokens.Count.CompareTo(rightTokens.Count);
        if (tokenCountCompare != 0)
        {
            return tokenCountCompare;
        }

        return string.Compare(left, right, StringComparison.OrdinalIgnoreCase);
    }
}

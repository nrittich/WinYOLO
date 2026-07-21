using BrokenBuild;
using Xunit;
namespace BrokenBuild.Tests;
public class CalculatorTests { [Fact] public void AddsTwoPositiveNumbers() => Assert.Equal(5, Calculator.Add(2, 3)); }

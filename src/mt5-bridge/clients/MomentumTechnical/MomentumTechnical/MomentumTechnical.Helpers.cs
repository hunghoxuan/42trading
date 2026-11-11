using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    public partial class MomentumTechnical
    {
        private static void TrySetPropertyValue(object target, string propertyName, object value)
        {
            CTraderChartEngine.TrySetPropertyValue(target, propertyName, value);
        }

        private static void TrySetEnumPropertyValue(object target, string propertyName, string enumName)
        {
            CTraderChartEngine.TrySetEnumPropertyValue(target, propertyName, enumName);
        }
        private double ComputeRelativeStrengthIndex(Bars sourceBars, int endIndex, int period)
        {
            return CTraderTechnicalEngine.ComputeRelativeStrengthIndex(sourceBars, endIndex, period);
        }
    }
    internal static class CTraderTechnicalEngine
    {
        public static double ComputeRelativeStrengthIndex(Bars bars, int endIndex, int period)
        {
            if (bars == null || period <= 0 || endIndex <= period)
                return double.NaN;
            double gain = 0;
            double loss = 0;
            for (var i = 1; i <= period; i++)
            {
                var delta = bars.ClosePrices[i] - bars.ClosePrices[i - 1];
                if (delta >= 0) gain += delta;
                else loss -= delta;
            }
            var averageGain = gain / period;
            var averageLoss = loss / period;
            for (var i = period + 1; i <= endIndex; i++)
            {
                var delta = bars.ClosePrices[i] - bars.ClosePrices[i - 1];
                averageGain = ((averageGain * (period - 1)) + (delta > 0 ? delta : 0)) / period;
                averageLoss = ((averageLoss * (period - 1)) + (delta < 0 ? -delta : 0)) / period;
            }
            if (averageLoss <= 0)
                return averageGain <= 0 ? 50.0 : 100.0;
            var rs = averageGain / averageLoss;
            return 100.0 - (100.0 / (1.0 + rs));
        }
    }
    internal static class CTraderChartEngine
    {
        // cTrader hides non-interactive drawings from Chart.Objects. Keep a weak registry of
        // names created by this bot so prefix cleanup and object-budget checks see every draw.
        private static readonly ConditionalWeakTable<object, HashSet<string>> TrackedNames =
            new ConditionalWeakTable<object, HashSet<string>>();
        private static readonly ConditionalWeakTable<object, HashSet<string>> DrawPassNames =
            new ConditionalWeakTable<object, HashSet<string>>();

        public static void BeginDrawPass(ChartArea area)
        {
            if (area == null) return;
            var names = DrawPassNames.GetOrCreateValue(area);
            lock (names) names.Clear();
        }

        public static List<string> GetDrawPassNames(ChartArea area)
        {
            if (area == null) return new List<string>();
            HashSet<string> names;
            if (!DrawPassNames.TryGetValue(area, out names)) return new List<string>();
            lock (names) return names.ToList();
        }

        public static T Track<T>(object owner, T chartObject) where T : ChartObject
        {
            if (owner != null && chartObject != null && !string.IsNullOrWhiteSpace(chartObject.Name))
            {
                var names = TrackedNames.GetOrCreateValue(owner);
                lock (names) names.Add(chartObject.Name);
                var drawnNames = DrawPassNames.GetOrCreateValue(owner);
                lock (drawnNames) drawnNames.Add(chartObject.Name);
            }
            return chartObject;
        }

        public static List<string> GetObjectNames(ChartArea area)
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (area == null) return names.ToList();
            try
            {
                foreach (var item in area.Objects)
                    if (item != null && !string.IsNullOrWhiteSpace(item.Name)) names.Add(item.Name);
            }
            catch { }
            HashSet<string> tracked;
            if (TrackedNames.TryGetValue(area, out tracked))
                lock (tracked) foreach (var name in tracked) names.Add(name);
            return names.ToList();
        }

        public static void RemoveObject(ChartArea area, string name)
        {
            if (area == null || string.IsNullOrWhiteSpace(name)) return;
            try { area.RemoveObject(name); } catch { }
            HashSet<string> tracked;
            if (TrackedNames.TryGetValue(area, out tracked))
                lock (tracked) tracked.Remove(name);
        }

        public static void TrySetPropertyValue(object target, string propertyName, object value)
        {
            if (target == null || string.IsNullOrWhiteSpace(propertyName) || value == null) return;
            try
            {
                var property = target.GetType().GetProperty(propertyName);
                if (property == null || !property.CanWrite) return;
                var targetType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                var converted = targetType == value.GetType()
                    ? value
                    : Convert.ChangeType(value, targetType, CultureInfo.InvariantCulture);
                property.SetValue(target, converted, null);
            }
            catch
            {
            }
        }

        public static void TrySetEnumPropertyValue(object target, string propertyName, string enumName)
        {
            if (target == null || string.IsNullOrWhiteSpace(propertyName) || string.IsNullOrWhiteSpace(enumName)) return;
            try
            {
                var property = target.GetType().GetProperty(propertyName);
                if (property == null || !property.CanWrite) return;
                var targetType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                if (!targetType.IsEnum) return;
                property.SetValue(target, Enum.Parse(targetType, enumName, true), null);
            }
            catch
            {
            }
        }
    }
}

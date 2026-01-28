package com.scmv.android.util

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Date formatting utilities for SCMV Android.
 * Uses java.time API with desugaring support for API 24+.
 */
object DateUtils {

    // Formatters are thread-safe and can be reused
    private val REQUEST_FORMATTER: DateTimeFormatter = 
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
    
    private val REQUEST_DATE_START_FORMATTER: DateTimeFormatter = 
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'00:00:00")
    
    private val REQUEST_DATE_END_FORMATTER: DateTimeFormatter = 
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'23:59:59")
    
    private val TIME_FORMATTER: DateTimeFormatter = 
        DateTimeFormatter.ofPattern("HH:mm:ss")

    // Response parsers - handle both 'T' separator and space separator
    private val RESPONSE_FORMATTER_T: DateTimeFormatter = 
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
    
    private val RESPONSE_FORMATTER_SPACE: DateTimeFormatter = 
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

    /**
     * Formats a LocalDateTime for API requests.
     * 
     * @param dateTime The date-time to format
     * @return Formatted string in "yyyy-MM-dd'T'HH:mm:ss" format
     */
    fun formatForRequest(dateTime: LocalDateTime): String {
        return dateTime.format(REQUEST_FORMATTER)
    }

    /**
     * Formats a LocalDate for API requests, optionally as end of day.
     * 
     * @param date The date to format
     * @param isEndOfDay If true, formats as 23:59:59, otherwise 00:00:00
     * @return Formatted string in "yyyy-MM-dd'T'HH:mm:ss" format
     */
    fun formatForRequest(date: LocalDate, isEndOfDay: Boolean = false): String {
        return if (isEndOfDay) {
            date.format(REQUEST_DATE_END_FORMATTER)
        } else {
            date.format(REQUEST_DATE_START_FORMATTER)
        }
    }

    /**
     * Parses a date-time string from API responses.
     * Handles both 'T' separator (ISO format) and space separator.
     * 
     * @param dateTimeString The string to parse (e.g., "2024-01-15T10:30:00" or "2024-01-15 10:30:00")
     * @return Parsed [LocalDateTime]
     * @throws DateTimeParseException if the string cannot be parsed
     */
    fun parseFromResponse(dateTimeString: String): LocalDateTime {
        return try {
            // Try ISO format with 'T' separator first
            LocalDateTime.parse(dateTimeString, RESPONSE_FORMATTER_T)
        } catch (e: DateTimeParseException) {
            // Fall back to space separator format
            LocalDateTime.parse(dateTimeString, RESPONSE_FORMATTER_SPACE)
        }
    }

    /**
     * Safely parses a date-time string from API responses.
     * Returns null instead of throwing an exception on parse failure.
     * 
     * @param dateTimeString The string to parse, or null
     * @return Parsed [LocalDateTime] or null if parsing fails
     */
    fun parseFromResponseOrNull(dateTimeString: String?): LocalDateTime? {
        if (dateTimeString.isNullOrBlank()) return null
        
        return try {
            parseFromResponse(dateTimeString)
        } catch (e: DateTimeParseException) {
            null
        }
    }

    /**
     * Parses a time string in "HH:mm:ss" format.
     * 
     * @param timeString The time string to parse (e.g., "10:30:45")
     * @return Parsed [LocalTime]
     * @throws DateTimeParseException if the string cannot be parsed
     */
    fun parseTime(timeString: String): LocalTime {
        return LocalTime.parse(timeString, TIME_FORMATTER)
    }

    /**
     * Safely parses a time string in "HH:mm:ss" format.
     * Returns null instead of throwing an exception on parse failure.
     * 
     * @param timeString The time string to parse, or null
     * @return Parsed [LocalTime] or null if parsing fails
     */
    fun parseTimeOrNull(timeString: String?): LocalTime? {
        if (timeString.isNullOrBlank()) return null
        
        return try {
            parseTime(timeString)
        } catch (e: DateTimeParseException) {
            null
        }
    }

    /**
     * Formats a duration in seconds to a human-readable string.
     * 
     * Examples:
     * - 90 seconds -> "1m 30s"
     * - 3661 seconds -> "1h 1m"
     * - 86400 seconds -> "1d 0h"
     * - 0 seconds -> "0s"
     * 
     * @param seconds The duration in seconds (must be non-negative)
     * @return Human-readable duration string
     */
    fun formatDuration(seconds: Long): String {
        if (seconds < 0) return "0s"
        if (seconds == 0L) return "0s"

        val days = seconds / 86400
        val hours = (seconds % 86400) / 3600
        val minutes = (seconds % 3600) / 60
        val secs = seconds % 60

        return buildString {
            if (days > 0) {
                append("${days}d ")
                append("${hours}h")
            } else if (hours > 0) {
                append("${hours}h ")
                append("${minutes}m")
            } else if (minutes > 0) {
                append("${minutes}m ")
                append("${secs}s")
            } else {
                append("${secs}s")
            }
        }.trim()
    }

    /**
     * Formats a duration in seconds to a compact format without seconds for longer durations.
     * 
     * Examples:
     * - 90 seconds -> "1m"
     * - 3661 seconds -> "1h 1m"
     * - 86400 seconds -> "1d 0h"
     * 
     * @param seconds The duration in seconds
     * @return Compact human-readable duration string
     */
    fun formatDurationCompact(seconds: Long): String {
        if (seconds < 0) return "0m"
        if (seconds < 60) return "<1m"

        val days = seconds / 86400
        val hours = (seconds % 86400) / 3600
        val minutes = (seconds % 3600) / 60

        return buildString {
            if (days > 0) {
                append("${days}d ")
                append("${hours}h")
            } else if (hours > 0) {
                append("${hours}h ")
                append("${minutes}m")
            } else {
                append("${minutes}m")
            }
        }.trim()
    }

    /**
     * Returns the current date-time formatted for API requests.
     * 
     * @return Current date-time in request format
     */
    fun nowForRequest(): String {
        return formatForRequest(LocalDateTime.now())
    }

    /**
     * Returns today's date formatted for API requests.
     * 
     * @param isEndOfDay If true, formats as end of day (23:59:59)
     * @return Today's date in request format
     */
    fun todayForRequest(isEndOfDay: Boolean = false): String {
        return formatForRequest(LocalDate.now(), isEndOfDay)
    }
}

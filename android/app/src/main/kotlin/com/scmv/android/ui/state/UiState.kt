package com.scmv.android.ui.state

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart

/**
 * Sealed interface representing the possible states of UI data.
 * 
 * @param T The type of data when in Success state.
 */
sealed interface UiState<out T> {
    
    /**
     * Initial loading state - data is being fetched.
     */
    object Loading : UiState<Nothing>
    
    /**
     * Success state - data has been loaded successfully.
     * 
     * @param data The loaded data.
     */
    data class Success<T>(val data: T) : UiState<T>
    
    /**
     * Error state - an error occurred while loading data.
     * 
     * @param message Human-readable error message.
     * @param throwable Optional underlying exception.
     */
    data class Error(
        val message: String,
        val throwable: Throwable? = null
    ) : UiState<Nothing>
    
    /**
     * Empty state - data loaded successfully but is empty.
     * Useful for distinguishing between "loading" and "no data".
     */
    object Empty : UiState<Nothing>
}

/**
 * Extension property to check if state is Loading.
 */
val <T> UiState<T>.isLoading: Boolean
    get() = this is UiState.Loading

/**
 * Extension property to check if state is Success.
 */
val <T> UiState<T>.isSuccess: Boolean
    get() = this is UiState.Success

/**
 * Extension property to check if state is Error.
 */
val <T> UiState<T>.isError: Boolean
    get() = this is UiState.Error

/**
 * Extension property to check if state is Empty.
 */
val <T> UiState<T>.isEmpty: Boolean
    get() = this is UiState.Empty

/**
 * Get the data if in Success state, or null otherwise.
 */
fun <T> UiState<T>.getOrNull(): T? = when (this) {
    is UiState.Success -> data
    else -> null
}

/**
 * Get the data if in Success state, or the default value otherwise.
 */
fun <T> UiState<T>.getOrDefault(default: T): T = when (this) {
    is UiState.Success -> data
    else -> default
}

/**
 * Get the data if in Success state, or throw an exception otherwise.
 */
fun <T> UiState<T>.getOrThrow(): T = when (this) {
    is UiState.Success -> data
    is UiState.Error -> throw throwable ?: IllegalStateException(message)
    is UiState.Loading -> throw IllegalStateException("Data is still loading")
    is UiState.Empty -> throw IllegalStateException("No data available")
}

/**
 * Get the error message if in Error state, or null otherwise.
 */
fun <T> UiState<T>.errorMessageOrNull(): String? = when (this) {
    is UiState.Error -> message
    else -> null
}

/**
 * Map the data in Success state to a new type.
 */
inline fun <T, R> UiState<T>.map(transform: (T) -> R): UiState<R> = when (this) {
    is UiState.Loading -> UiState.Loading
    is UiState.Success -> UiState.Success(transform(data))
    is UiState.Error -> UiState.Error(message, throwable)
    is UiState.Empty -> UiState.Empty
}

/**
 * FlatMap the data in Success state to a new UiState.
 */
inline fun <T, R> UiState<T>.flatMap(transform: (T) -> UiState<R>): UiState<R> = when (this) {
    is UiState.Loading -> UiState.Loading
    is UiState.Success -> transform(data)
    is UiState.Error -> UiState.Error(message, throwable)
    is UiState.Empty -> UiState.Empty
}

/**
 * Execute an action if in Success state.
 */
inline fun <T> UiState<T>.onSuccess(action: (T) -> Unit): UiState<T> {
    if (this is UiState.Success) {
        action(data)
    }
    return this
}

/**
 * Execute an action if in Error state.
 */
inline fun <T> UiState<T>.onError(action: (String, Throwable?) -> Unit): UiState<T> {
    if (this is UiState.Error) {
        action(message, throwable)
    }
    return this
}

/**
 * Execute an action if in Loading state.
 */
inline fun <T> UiState<T>.onLoading(action: () -> Unit): UiState<T> {
    if (this is UiState.Loading) {
        action()
    }
    return this
}

/**
 * Execute an action if in Empty state.
 */
inline fun <T> UiState<T>.onEmpty(action: () -> Unit): UiState<T> {
    if (this is UiState.Empty) {
        action()
    }
    return this
}

/**
 * Fold the UiState into a single value.
 */
fun <T, R> UiState<T>.fold(
    onLoading: () -> R,
    onSuccess: (T) -> R,
    onError: (String, Throwable?) -> R,
    onEmpty: () -> R = onLoading
): R = when (this) {
    is UiState.Loading -> onLoading()
    is UiState.Success -> onSuccess(data)
    is UiState.Error -> onError(message, throwable)
    is UiState.Empty -> onEmpty()
}

/**
 * Recover from an error state with a default value.
 */
inline fun <T> UiState<T>.recover(recovery: (String, Throwable?) -> T): UiState<T> = when (this) {
    is UiState.Error -> UiState.Success(recovery(message, throwable))
    else -> this
}

/**
 * Recover from an error state with a new UiState.
 */
inline fun <T> UiState<T>.recoverWith(recovery: (String, Throwable?) -> UiState<T>): UiState<T> = when (this) {
    is UiState.Error -> recovery(message, throwable)
    else -> this
}

// Flow extensions

/**
 * Convert a Flow<T> to Flow<UiState<T>>, handling loading, success, and error states.
 */
fun <T> Flow<T>.asUiState(): Flow<UiState<T>> = this
    .map<T, UiState<T>> { UiState.Success(it) }
    .onStart { emit(UiState.Loading) }
    .catch { emit(UiState.Error(it.message ?: "Unknown error", it)) }

/**
 * Convert a Flow<T> to Flow<UiState<T>> with empty state detection for collections.
 */
fun <T : Collection<*>> Flow<T>.asUiStateWithEmpty(): Flow<UiState<T>> = this
    .map<T, UiState<T>> { 
        if (it.isEmpty()) UiState.Empty else UiState.Success(it) 
    }
    .onStart { emit(UiState.Loading) }
    .catch { emit(UiState.Error(it.message ?: "Unknown error", it)) }

/**
 * Map the data in a Flow<UiState<T>> to a new type.
 */
fun <T, R> Flow<UiState<T>>.mapData(transform: (T) -> R): Flow<UiState<R>> = 
    map { state -> state.map(transform) }

// Result extensions

/**
 * Convert a Kotlin Result<T> to UiState<T>.
 */
fun <T> Result<T>.toUiState(): UiState<T> = fold(
    onSuccess = { UiState.Success(it) },
    onFailure = { UiState.Error(it.message ?: "Unknown error", it) }
)

/**
 * Convert a nullable value to UiState, using Empty for null.
 */
@JvmName("nullableToUiState")
fun <T : Any> T?.toUiStateOrEmpty(): UiState<T> = when (this) {
    null -> UiState.Empty
    else -> UiState.Success(this)
}

/**
 * Convert a collection to UiState, using Empty for empty collections.
 */
fun <T : Collection<*>> T.toUiStateWithEmpty(): UiState<T> = when {
    isEmpty() -> UiState.Empty
    else -> UiState.Success(this)
}

// Combining UiStates

/**
 * Combine two UiStates into a Pair.
 * Returns Loading if any is Loading, Error if any is Error, Success only if both are Success.
 */
fun <A, B> combineUiStates(
    stateA: UiState<A>,
    stateB: UiState<B>
): UiState<Pair<A, B>> = when {
    stateA is UiState.Loading || stateB is UiState.Loading -> UiState.Loading
    stateA is UiState.Error -> UiState.Error(stateA.message, stateA.throwable)
    stateB is UiState.Error -> UiState.Error(stateB.message, stateB.throwable)
    stateA is UiState.Empty || stateB is UiState.Empty -> UiState.Empty
    stateA is UiState.Success && stateB is UiState.Success -> UiState.Success(stateA.data to stateB.data)
    else -> UiState.Loading
}

/**
 * Combine three UiStates into a Triple.
 */
fun <A, B, C> combineUiStates(
    stateA: UiState<A>,
    stateB: UiState<B>,
    stateC: UiState<C>
): UiState<Triple<A, B, C>> = when {
    stateA is UiState.Loading || stateB is UiState.Loading || stateC is UiState.Loading -> UiState.Loading
    stateA is UiState.Error -> UiState.Error(stateA.message, stateA.throwable)
    stateB is UiState.Error -> UiState.Error(stateB.message, stateB.throwable)
    stateC is UiState.Error -> UiState.Error(stateC.message, stateC.throwable)
    stateA is UiState.Empty || stateB is UiState.Empty || stateC is UiState.Empty -> UiState.Empty
    stateA is UiState.Success && stateB is UiState.Success && stateC is UiState.Success -> 
        UiState.Success(Triple(stateA.data, stateB.data, stateC.data))
    else -> UiState.Loading
}

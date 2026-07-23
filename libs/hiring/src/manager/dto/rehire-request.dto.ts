import { CreateRequestDto } from './create-request.dto';

/**
 * UC-16 A2 · Rehire urgente (KER-32, NFR-15/23): re-solicitud dirigida a un cuidador que ya
 * atendió al paciente, sin re-búsqueda. Mismos campos que la solicitud normal; la precondición
 * (asignación previa con ese paciente) la valida el manager.
 */
export class RehireRequestDto extends CreateRequestDto {}

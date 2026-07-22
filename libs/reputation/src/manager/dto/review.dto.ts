import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Review } from '../../resource-access/entities/review.entity';
import { Aggregate } from '../../resource-access/review.access';

/** UC-17/21 · Enviar reseña (calificación + comentario). */
export class SubmitReviewDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Muy atenta y puntual' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() rating!: number;
  @ApiPropertyOptional() comment?: string | null;
  @ApiProperty({ enum: ['caregiver', 'patient'] }) subjectType!: string;
  @ApiProperty() revealed!: boolean;
  @ApiProperty() createdAt!: Date;

  static from(r: Review): ReviewDto {
    return {
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      subjectType: r.subjectType,
      revealed: r.revealed,
      createdAt: r.createdAt,
    };
  }
}

export class ReputationDto {
  @ApiProperty({ example: { average: 4.5, count: 2 } }) aggregate!: Aggregate;
  @ApiProperty({ type: ReviewDto, isArray: true }) reviews!: ReviewDto[];
}
